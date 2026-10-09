// AI lead scoring (spec A11): evidence-based factors from the AI + factors from your data,
// combined with YOUR weights (Settings → Company → Scoring). The AI never decides the number.
import crypto from 'node:crypto';
import { z } from 'zod';
import Lead from '../../../models/Lead.js';
import User from '../../../models/User.js';
import AiAnalysis from '../../../models/AiAnalysis.js';
import AiBatchJob, { BATCH_MAX } from '../../../models/AiBatchJob.js';
import TenantSettings from '../../../models/TenantSettings.js';
import ApiError from '../../../utils/ApiError.js';
import logger from '../../../config/logger.js';
import { DEFAULT_SCORING_WEIGHTS } from '../../../config/settingsOptions.js';
import { PERMISSIONS as P, hasPermission } from '../../../config/permissions.js';
import { runAsSystem, runWithTenant } from '../../../utils/tenantContext.js';
import { scopeFilter } from '../../leads/leadService.js';
import { looksLikePromptInjection } from '../../leads/normalize.js';
import { recordAudit } from '../../audit/auditService.js';
import { runAi, getAiSettings } from '../aiService.js';
import { SAFETY_RULES, dataBlock } from '../promptSafety.js';
import { collectEvidence } from '../evidenceFacts.js';
import { AI_FACTORS, dataFactors, verifyAiScoring, computeScore, buildReason } from './scoreFormula.js';
import { SCORE_JSON_SCHEMA, LEAD_TYPES } from './scoreSchema.js';
import { latestAuditFor } from '../../websiteAudit/websiteAuditService.js';

const TYPE = 'LEAD_SCORE';
const PROMPT_VERSION = 'score-v1';
const CLOSED = ['CONVERTED', 'NOT_INTERESTED', 'LOST'];

const factorOut = z.object({ value: z.number().int().min(0).max(10), reason: z.string().trim().max(200), quote: z.string().trim().max(300).nullable() }).strict();
export const scoreOutputSchema = z
  .object({
    factors: z.object(Object.fromEntries(AI_FACTORS.map((k) => [k, factorOut]))).strict(),
    intent: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    leadType: z.enum(LEAD_TYPES),
    potentialService: z.string().trim().max(120).nullable(),
    recommendedAction: z.string().trim().max(300),
    evidenceSummary: z.string().trim().max(400),
  })
  .strict();

const SYSTEM = `${SAFETY_RULES}

Task: rate ONE sales lead for the company described in <data name="company">. Rate only these factors, each 0-10:
- explicitBuyerIntent: the author clearly says they want to buy / hire / need the service
- businessRelevance: the lead is a business/person this company could serve
- serviceMatch: what they need matches one of the company's services
- publicActivity: signs the person/business is active (recent post, running business)
- evidenceStrength: how clear and specific the evidence is
Rules:
- For any value above 3 you MUST copy an exact quote from <data name="evidence"> that proves it; otherwise use 3 or less and quote null.
- potentialService must be one of the company's services exactly as written, or null.
- Do NOT output a total score. Do NOT guess budgets, names or contact details.
- recommendedAction: one short, honest next step (e.g. "Reply to the post asking about their requirements").`;

async function loadSettings() {
  const s = await TenantSettings.findOne({}).select('services icp scoringWeights');
  const o = s?.toObject() || {};
  const weights = { ...DEFAULT_SCORING_WEIGHTS, ...(o.scoringWeights || {}) };
  return { services: (o.services || []).map((x) => x.name), icp: o.icp || {}, weights };
}

/** Only what is needed to judge fit — never email/phone (data minimisation). */
function leadForPrompt(lead) {
  const domain = (() => {
    try {
      return lead.website ? new URL(lead.website).hostname : null;
    } catch {
      return null;
    }
  })();
  return [
    ['Lead name', lead.name],
    ['Company', lead.companyName],
    ['Industry', lead.industry],
    ['City', lead.city],
    ['Country', lead.country],
    ['Website domain', domain],
    ['Source', lead.source],
    ['Requirement noted', lead.requiredService],
    ['Business problem noted', lead.businessProblem],
    ['Budget stated', lead.budgetStated],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

function companyForPrompt(settings) {
  return [
    `Services: ${settings.services.join('; ') || '(none listed)'}`,
    `Target industries: ${(settings.icp.industries || []).join('; ') || '-'}`,
    `Target cities: ${(settings.icp.cities || []).join('; ') || '-'}`,
    `Target countries: ${(settings.icp.countries || []).join('; ') || '-'}`,
    `Business types: ${(settings.icp.businessTypes || []).join('; ') || '-'}`,
  ].join('\n');
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Combines saved AI factors + fresh data factors with the CURRENT weights, and writes the lead. */
async function applyScore(lead, aiPart, settings) {
  const websiteAudit = await latestAuditFor(lead._id);
  const factors = { ...dataFactors(lead, settings, { websiteAudit }), ...aiPart.factors };
  const result = computeScore(factors, settings.weights);
  const reason = buildReason(factors, settings.weights, result);
  await Lead.updateOne(
    { _id: lead._id },
    {
      $set: {
        score: result.score,
        scoreReason: reason,
        intent: aiPart.intent,
        leadType: aiPart.leadType,
        potentialService: aiPart.potentialService,
        recommendedAction: aiPart.recommendedAction ? aiPart.recommendedAction.slice(0, 500) : null,
        scoredAt: new Date(),
      },
    }
  );
  return { score: result.score, factors, used: result.used, excluded: result.excluded, reason };
}

/**
 * Score one lead. `auth` is the user (or the batch owner). Returns the analysis + breakdown.
 * Cache: same lead text + same company profile + same model → saved AI factors are reused (no AI cost);
 * the score is still recalculated with the current weights and data.
 */
export async function scoreLead(auth, leadId, { force = false } = {}) {
  const lead = await Lead.findOne({ _id: leadId, ...scopeFilter(auth) });
  if (!lead) throw ApiError.notFound('Lead not found');
  const settings = await loadSettings();
  const evidence = collectEvidence(lead);
  const profile = leadForPrompt(lead);
  if (evidence.length < 10 && profile.split('\n').length < 3) throw ApiError.badRequest('Not enough information to score this lead (add evidence or details first).');

  const ai = await getAiSettings();
  const inputHash = sha(`${PROMPT_VERSION}|${ai.provider}|${ai.model || 'default'}|${companyForPrompt(settings)}|${profile}|${evidence}`);
  if (!force) {
    const cached = await AiAnalysis.findOne({ leadId: lead._id, type: TYPE, status: 'COMPLETED', inputHash }).sort({ createdAt: -1 });
    if (cached) {
      const breakdown = await applyScore(lead, cached.result, settings);
      return { ...cached.toJSON(), breakdown, cached: true };
    }
  }

  await AiAnalysis.updateMany({ leadId: lead._id, type: TYPE, status: 'RUNNING', createdAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) } }, { $set: { status: 'FAILED', error: 'Interrupted' } });
  let analysis;
  try {
    analysis = await AiAnalysis.create({ leadId: lead._id, type: TYPE, status: 'RUNNING', inputHash, createdBy: auth.userId });
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('This lead is already being scored — please wait a moment.');
    throw err;
  }

  try {
    const { data, usage, usageLogId } = await runAi(auth, {
      requestType: 'LEAD_SCORING',
      system: SYSTEM,
      user: [dataBlock('company', companyForPrompt(settings), 4000), dataBlock('lead', profile, 3000), dataBlock('evidence', evidence || '(no evidence text)', 20000), 'Return the JSON for this lead.'].join('\n\n'),
      schemaName: 'lead_score',
      jsonSchema: SCORE_JSON_SCHEMA,
      outputSchema: scoreOutputSchema,
      target: { type: 'Lead', id: lead._id },
    });
    const suspicious = lead.suspectedInjection || looksLikePromptInjection(evidence);
    const checked = verifyAiScoring(data, evidence, settings.services, { suspicious });
    const aiPart = { ...checked, recommendedAction: data.recommendedAction, evidenceSummary: data.evidenceSummary };
    analysis.set({ status: 'COMPLETED', result: aiPart, droppedClaims: checked.unsupported, provider: usage.provider, model: usage.model, usageLogId });
    await analysis.save();
    const breakdown = await applyScore(lead, aiPart, settings);
    return { ...analysis.toJSON(), breakdown, usage, cached: false };
  } catch (err) {
    analysis.set({ status: 'FAILED', error: String(err.message || 'failed').slice(0, 200), usageLogId: err.usageLogId || null });
    await analysis.save();
    throw err;
  }
}

export async function latestScore(auth, leadId) {
  const lead = await Lead.findOne({ _id: leadId, ...scopeFilter(auth) });
  if (!lead) throw ApiError.notFound('Lead not found');
  const a = await AiAnalysis.findOne({ leadId: lead._id, type: TYPE, status: 'COMPLETED' }).sort({ createdAt: -1 });
  if (!a) return null;
  const settings = await loadSettings();
  const websiteAudit = await latestAuditFor(lead._id);
  const factors = { ...dataFactors(lead, settings, { websiteAudit }), ...a.result.factors };
  return { ...a.toJSON(), breakdown: { factors, weights: settings.weights, ...computeScore(factors, settings.weights) } };
}

/** Weights changed → recalculate every scored lead from its SAVED factors. No AI call, no cost. */
export async function recalculateScores(actor, { limit = 5000 } = {}) {
  const settings = await loadSettings();
  const analyses = await AiAnalysis.aggregate([
    { $match: { type: TYPE, status: 'COMPLETED' } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$leadId', result: { $first: '$result' } } },
    { $limit: limit },
  ]);
  const byLead = new Map(analyses.map((a) => [String(a._id), a.result]));
  const leads = await Lead.find({ _id: { $in: [...byLead.keys()] } });
  for (const lead of leads) await applyScore(lead, byLead.get(String(lead._id)), settings);
  await recordAudit({ actorType: 'USER', actorId: actor.userId, tenantId: actor.tenantId, action: 'scoring.recalculated', metadata: { leads: leads.length } });
  return { recalculated: leads.length, limited: analyses.length >= limit };
}

/** After a website audit: refresh this lead's score from its SAVED factors (no AI call). */
export async function rescoreLeadFromSaved(leadId) {
  const a = await AiAnalysis.findOne({ leadId, type: TYPE, status: 'COMPLETED' }).sort({ createdAt: -1 });
  if (!a) return null;
  const lead = await Lead.findById(leadId);
  if (!lead) return null;
  return applyScore(lead, a.result, await loadSettings());
}

// ------------------------------------------------------------------ batches (background)

export async function createBatch(auth, { mode, leadIds = [], force = false }) {
  let ids;
  if (mode === 'SELECTED') {
    const found = await Lead.find({ _id: { $in: leadIds }, ...scopeFilter(auth) }).select('_id').limit(BATCH_MAX);
    ids = found.map((l) => l._id);
  } else {
    // UNSCORED: open leads without a score, not on do-not-contact — oldest first
    const found = await Lead.find({ score: null, status: { $nin: CLOSED }, doNotContact: false, ...scopeFilter(auth) }).sort({ createdAt: 1 }).select('_id').limit(BATCH_MAX);
    ids = found.map((l) => l._id);
  }
  if (!ids.length) throw ApiError.badRequest('No leads to score');
  try {
    const job = await AiBatchJob.create({ leadIds: ids, force: Boolean(force), stats: { total: ids.length }, createdBy: auth.userId });
    await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'scoring.batch_created', targetType: 'AiBatchJob', targetId: job._id, metadata: { total: ids.length, mode } });
    return publicBatch(job);
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('A scoring batch is already running — wait for it or cancel it.');
    throw err;
  }
}

const publicBatch = (j) => {
  const o = j.toJSON();
  delete o.leadIds;
  return o;
};

export async function listBatches() {
  const items = await AiBatchJob.find({}).sort({ createdAt: -1 }).limit(10).populate('createdBy', 'name');
  return items.map(publicBatch);
}

export async function cancelBatch(auth, id) {
  const filter = { _id: id, status: { $in: ['QUEUED', 'RUNNING'] } };
  if (!hasPermission(auth.role, P.LEADS_ASSIGN)) filter.createdBy = auth.userId; // sales: only their own
  const job = await AiBatchJob.findOneAndUpdate(filter, { $set: { status: 'CANCELLED', activeLock: false, finishedAt: new Date(), note: 'Cancelled' } }, { new: true });
  if (!job) throw ApiError.notFound('No running batch with this id');
  return publicBatch(job);
}

/** Worker: atomically claim the oldest queued batch (safe with several servers). */
export async function claimNextBatch(now = new Date()) {
  return runAsSystem('batch:claim', () =>
    AiBatchJob.findOneAndUpdate(
      { status: 'QUEUED' },
      { $set: { status: 'RUNNING', startedAt: now, lockedUntil: new Date(now.getTime() + 10 * 60 * 1000) } },
      { sort: { createdAt: 1 }, new: true }
    )
  );
}

export async function processBatch(job) {
  return runWithTenant({ tenantId: job.tenantId }, async () => {
    const user = await User.findOne({ _id: job.createdBy, status: 'ACTIVE' });
    const finish = (status, note) =>
      AiBatchJob.updateOne({ _id: job._id, status: 'RUNNING' }, { $set: { status, note, activeLock: false, finishedAt: new Date(), lockedUntil: null } });
    if (!user || !hasPermission(user.role, P.LEADS_WRITE)) return finish('FAILED', 'The user who started this batch can no longer score leads');
    const auth = { userId: String(user._id), tenantId: String(job.tenantId), role: user.role };

    for (const leadId of job.leadIds) {
      const current = await AiBatchJob.findById(job._id).select('status');
      if (current?.status !== 'RUNNING') return null; // cancelled
      let inc = { 'stats.processed': 1 };
      try {
        const r = await scoreLead(auth, leadId, { force: job.force });
        inc = { ...inc, [r.cached ? 'stats.cached' : 'stats.succeeded']: 1 };
      } catch (err) {
        if (err.statusCode === 402) {
          await AiBatchJob.updateOne({ _id: job._id }, { $inc: { 'stats.skipped': job.leadIds.length - (await AiBatchJob.findById(job._id)).stats.processed } });
          return finish('COMPLETED', 'Stopped: your plan’s monthly AI limit was reached');
        }
        if (err.statusCode === 400 && err.errors?.[0]?.code === 'AI_NOT_CONFIGURED') return finish('FAILED', 'No AI key connected');
        inc = { ...inc, [err.statusCode === 404 || err.statusCode === 400 ? 'stats.skipped' : 'stats.failed']: 1 };
        if (!err.statusCode || err.statusCode >= 500) logger.warn({ err: err.message, jobId: String(job._id) }, 'batch item failed');
      }
      await AiBatchJob.updateOne({ _id: job._id }, { $inc: inc, $set: { lockedUntil: new Date(Date.now() + 10 * 60 * 1000) } });
    }
    return finish('COMPLETED', null);
  });
}

/** A batch whose server died: give up after its lock expired. */
export async function recoverStaleBatches(now = new Date()) {
  const r = await runAsSystem('batch:recover', () =>
    AiBatchJob.updateMany({ status: 'RUNNING', lockedUntil: { $lt: now } }, { $set: { status: 'FAILED', activeLock: false, note: 'Interrupted (server restart) — start it again', finishedAt: now } })
  );
  return r.modifiedCount;
}
