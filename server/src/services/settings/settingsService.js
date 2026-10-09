// Tenant settings: read, update one section at a time, apply an Industry Pack, finish onboarding.
// All queries run inside the tenant context → the tenant plugin scopes them automatically.
import TenantSettings from '../../models/TenantSettings.js';
import Tenant from '../../models/Tenant.js';
import IndustryPack from '../../models/IndustryPack.js';
import { findActiveModel } from '../ai/modelPricingService.js';
import ApiError from '../../utils/ApiError.js';
import { recordAudit } from '../audit/auditService.js';
import { isReadableAccent, MIN_CONTRAST } from '../../utils/color.js';
import { LIST_LIMITS } from '../../config/settingsOptions.js';
import { dedupe } from '../../validators/settings.validators.js';

export async function ensureSettings(tenantId) {
  const existing = await TenantSettings.findOne({ tenantId });
  if (existing) return existing;
  try {
    return await TenantSettings.create({ tenantId });
  } catch (err) {
    if (err.code === 11000) return TenantSettings.findOne({ tenantId }); // created by a parallel request
    throw err;
  }
}

function toResponse(settings, tenant) {
  const json = settings.toJSON();
  json.companyName = tenant?.name ?? null;
  json.branding.hasLogo = Boolean(settings.branding?.logoAssetId);
  delete json.branding.logoAssetId; // internal id, not needed by the UI
  json.onboardingRequired = !settings.onboarding?.completedAt;
  return json;
}

export async function getSettings(tenantId) {
  const [settings, tenant] = await Promise.all([ensureSettings(tenantId), Tenant.findById(tenantId).select('name')]);
  return toResponse(settings, tenant);
}

const audit = (actor, action, metadata = {}) =>
  recordAudit({
    actorType: 'USER', actorId: actor.userId, tenantId: actor.tenantId, action,
    targetType: 'TenantSettings', metadata,
  });

/** Applies validated data to one section. Only fields that were sent are changed. */
export async function updateSection(actor, section, data) {
  const settings = await ensureSettings(actor.tenantId);

  switch (section) {
    case 'profile': {
      const { companyName, socialLinks, ...rest } = data;
      for (const [k, v] of Object.entries(rest)) settings.set(`profile.${k}`, v);
      if (socialLinks) for (const [k, v] of Object.entries(socialLinks)) settings.set(`profile.socialLinks.${k}`, v);
      if (companyName) await Tenant.updateOne({ _id: actor.tenantId }, { $set: { name: companyName } });
      break;
    }
    case 'services':
      settings.services = data.services;
      break;
    case 'icp':
    case 'discovery':
      for (const [k, v] of Object.entries(data)) settings.set(`${section}.${k}`, v);
      break;
    case 'brandVoice':
      settings.brandVoice = data;
      break;
    case 'branding':
      if (data.accentColor && !isReadableAccent(data.accentColor)) {
        throw ApiError.badRequest('Validation failed', [
          { field: 'accentColor', message: `This colour is too light or too dark to read. Pick a mid-tone colour (contrast ≥ ${MIN_CONTRAST}:1 with white and with the dark background).` },
        ]);
      }
      settings.set('branding.accentColor', data.accentColor);
      break;
    case 'pipeline':
      settings.pipelineStages = data.pipelineStages;
      break;
    case 'scoring':
      settings.scoringWeights = data.scoringWeights;
      break;
    case 'outreach':
    case 'general':
    case 'sales':
      for (const [k, v] of Object.entries(data)) settings.set(`${section}.${k}`, v);
      break;
    case 'ai': {
      const next = { ...(settings.ai?.toObject ? settings.ai.toObject() : settings.ai || {}), ...data };
      if (next.provider === 'AUTO' || !next.provider) next.model = null; // Auto always uses the default models
      if (next.model) {
        const m = await findActiveModel(next.provider, next.model);
        if (!m) throw ApiError.badRequest('Validation failed', [{ field: 'model', message: 'Choose a model from the list for this provider' }]);
      }
      settings.ai = next;
      break;
    }
    default:
      throw ApiError.notFound('Unknown settings section');
  }

  await settings.save();
  await audit(actor, `settings.${section}_updated`, { fields: Object.keys(data) });
  if (section === 'scoring') {
    // new weights → every scored lead is recalculated from its saved factors (no AI call, no cost)
    const { recalculateScores } = await import('../ai/scoring/leadScoring.js');
    await recalculateScores(actor);
  }
  return getSettings(actor.tenantId);
}

// ---------------------------------------------------------------- industry packs

export async function listActivePacks() {
  const packs = await IndustryPack.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).limit(100);
  return packs.map((p) => p.toJSON());
}

const merge = (current, incoming, max) => dedupe([...(current || []), ...(incoming || [])]).slice(0, max);

/**
 * Copies a pack into the tenant's settings.
 *  REPLACE → pack values replace the current lists (profile, ICP locations and brand are never touched)
 *  MERGE   → pack values are added to what the tenant already has (duplicates removed)
 */
export async function applyIndustryPack(actor, { packId, mode }) {
  const pack = await IndustryPack.findOne({ _id: packId, isActive: true });
  if (!pack) throw ApiError.badRequest('This industry pack is not available');

  const settings = await ensureSettings(actor.tenantId);
  const p = pack.toObject();
  const replace = mode === 'REPLACE';
  const pick = (current, incoming, max) => (replace ? (incoming || []).slice(0, max) : merge(current, incoming, max));

  settings.services = pick(settings.services?.map((s) => ({ name: s.name, description: s.description })), p.services, LIST_LIMITS.services);
  settings.set('discovery.keywords', pick(settings.discovery.keywords, p.keywords, LIST_LIMITS.keywords));
  settings.set('discovery.hashtags', pick(settings.discovery.hashtags, p.hashtags, LIST_LIMITS.hashtags));
  settings.set('discovery.intentPhrases', pick(settings.discovery.intentPhrases, p.intentPhrases, LIST_LIMITS.intentPhrases));
  settings.set('discovery.negativeKeywords', pick(settings.discovery.negativeKeywords, p.negativeKeywords, LIST_LIMITS.negativeKeywords));
  settings.set('discovery.preferredSources', replace ? p.sources : [...new Set([...settings.discovery.preferredSources, ...p.sources])]);
  for (const key of ['industries', 'businessTypes', 'targetRoles']) {
    settings.set(`icp.${key}`, pick(settings.icp[key], p.icp?.[key], LIST_LIMITS.icpItems));
  }
  const templates = (p.messageTemplates || []).map(({ name, channel, subject, body }) => ({ name, channel, subject, body }));
  settings.messageTemplates = replace
    ? templates
    : dedupe([...settings.messageTemplates.map((t) => t.toObject?.() ?? t), ...templates]).slice(0, LIST_LIMITS.templates);
  if (replace || !settings.industryPack?.packId) {
    if (p.pipelineStages?.length >= 2) settings.pipelineStages = p.pipelineStages;
    if (p.scoringWeights) settings.scoringWeights = p.scoringWeights;
  }
  settings.industryPack = { packId: pack._id, code: pack.code, name: pack.name, appliedAt: new Date() };

  await settings.save();
  await audit(actor, 'settings.industry_pack_applied', { pack: pack.code, mode });
  return getSettings(actor.tenantId);
}

export async function completeOnboarding(actor, { skipped }) {
  const settings = await ensureSettings(actor.tenantId);
  if (!settings.onboarding.completedAt) {
    settings.onboarding = { completedAt: new Date(), skipped };
    await settings.save();
    await audit(actor, skipped ? 'settings.onboarding_skipped' : 'settings.onboarding_completed');
  }
  return getSettings(actor.tenantId);
}
