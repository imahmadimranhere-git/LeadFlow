// /api/v1/leads — lead management.
// Read: leads:read:all (everyone except sales) or leads:read:own (sales → only their own leads).
// Write: leads:write. Assign: leads:assign. Delete/merge/DNC: leads:delete.
import { Router } from 'express';
import authenticate from '../middleware/authenticate.js';
import authorize, { authorizeAny } from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import * as leads from '../services/leads/leadService.js';
import * as dnc from '../services/leads/dncService.js';
import * as v from '../validators/leads.validators.js';
import rateLimit from 'express-rate-limit';
import env from '../config/env.js';
import { z } from '../validators/common.js';
import { analyzeEvidence, latestAnalyses } from '../services/ai/evidenceFacts.js';
import { scoreLead, latestScore } from '../services/ai/scoring/leadScoring.js';
import { auditLead, listLeadAudits } from '../services/websiteAudit/websiteAuditService.js';

const router = Router();
router.use(authenticate);

const canRead = authorizeAny(P.LEADS_READ_ALL, P.LEADS_READ_OWN);
const canWrite = authorize(P.LEADS_WRITE);
const canDelete = authorize(P.LEADS_DELETE);
const h = (fn) => asyncHandler(fn);

// ---- do-not-contact list (before /:id routes) ----
router.get('/do-not-contact', canDelete, validate({ query: v.dncListQuery }), h(async (req, res) => {
  const q = req.validated.query;
  const { items, total } = await dnc.listDnc(q);
  sendPaginated(res, items, { page: q.page, limit: q.limit, total });
}));
router.post('/do-not-contact', canDelete, validate({ body: v.dncBody }), h(async (req, res) => sendSuccess(res, await dnc.addDnc(req.auth, req.validated.body), 201)));
router.delete('/do-not-contact/:id', canDelete, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, await dnc.removeDnc(req.auth, req.validated.params.id))));

// ---- collection ----
router.get('/', canRead, validate({ query: v.listLeadsQuery }), h(async (req, res) => {
  const q = req.validated.query;
  const { items, total } = await leads.listLeads(req.auth, q);
  sendPaginated(res, items, { page: q.page, limit: q.limit, total });
}));
router.get('/stats', canRead, validate({}), h(async (req, res) => sendSuccess(res, await leads.getStats(req.auth))));
router.get('/pipeline', canRead, validate({}), h(async (req, res) => sendSuccess(res, await leads.getPipeline(req.auth))));
router.post('/', canWrite, validate({ body: v.createLeadBody }), h(async (req, res) => sendSuccess(res, { lead: await leads.createLead(req.auth, req.validated.body) }, 201)));
router.post('/check-duplicates', canWrite, validate({ body: v.checkDuplicatesBody }), h(async (req, res) => sendSuccess(res, { duplicates: await leads.checkDuplicates(req.auth, req.validated.body) })));
router.post('/bulk', canWrite, validate({ body: v.bulkBody }), h(async (req, res) => sendSuccess(res, await leads.bulkUpdate(req.auth, req.validated.body))));

// ---- single lead ----
router.get('/:id', canRead, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, { lead: await leads.getLead(req.auth, req.validated.params.id) })));
router.patch('/:id', canWrite, validate({ params: v.idParams, body: v.updateLeadBody }), h(async (req, res) =>
  sendSuccess(res, { lead: await leads.updateLead(req.auth, req.validated.params.id, req.validated.body) })));
router.patch('/:id/stage', canWrite, validate({ params: v.idParams, body: v.stageBody }), h(async (req, res) =>
  sendSuccess(res, { lead: await leads.moveStage(req.auth, req.validated.params.id, req.validated.body.pipelineStage) })));
router.delete('/:id', canDelete, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, await leads.deleteLead(req.auth, req.validated.params.id))));
router.post('/:id/sources', canWrite, validate({ params: v.idParams, body: v.addSourceBody }), h(async (req, res) =>
  sendSuccess(res, { lead: await leads.addSource(req.auth, req.validated.params.id, req.validated.body) }, 201)));
router.post('/:id/merge', canDelete, validate({ params: v.idParams, body: v.mergeBody }), h(async (req, res) =>
  sendSuccess(res, { lead: await leads.mergeLeads(req.auth, req.validated.params.id, req.validated.body.duplicateId) })));

router.get('/:id/activities', canRead, validate({ params: v.idParams, query: v.activitiesQuery }), h(async (req, res) => {
  const q = req.validated.query;
  const { items, total } = await leads.listActivities(req.auth, req.validated.params.id, q);
  sendPaginated(res, items, { page: q.page, limit: q.limit, total });
}));
// ---- AI (each call costs money → limited per company, on top of the plan quota)
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: env.AI_RATE_LIMIT_PER_MINUTE,
  keyGenerator: (req) => `ai:${req.auth.tenantId}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Too many AI requests — please wait a minute.', errors: [] }),
});
const aiRunBody = z.object({ force: z.boolean().default(false) }).strict();
router.post('/:id/ai/evidence-facts', canWrite, aiLimiter, validate({ params: v.idParams, body: aiRunBody }), h(async (req, res) =>
  sendSuccess(res, { analysis: await analyzeEvidence(req.auth, req.validated.params.id, req.validated.body) })));
router.post('/:id/ai/score', canWrite, aiLimiter, validate({ params: v.idParams, body: aiRunBody }), h(async (req, res) =>
  sendSuccess(res, { analysis: await scoreLead(req.auth, req.validated.params.id, req.validated.body) })));
router.get('/:id/ai/score', canRead, validate({ params: v.idParams }), h(async (req, res) =>
  sendSuccess(res, { analysis: await latestScore(req.auth, req.validated.params.id) })));
router.get('/:id/ai/analyses', canRead, validate({ params: v.idParams }), h(async (req, res) =>
  sendSuccess(res, { items: await latestAnalyses(req.auth, req.validated.params.id) })));

// ---- website audit (fetches the lead's public site → limited per company)
const auditLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: Math.max(20, Math.floor(env.AUTH_RATE_LIMIT_MAX / 2)),
  keyGenerator: (req) => `audit:${req.auth.tenantId}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Too many website checks — please wait a few minutes.', errors: [] }),
});
router.post('/:id/website-audit', canWrite, auditLimiter, validate({ params: v.idParams }), h(async (req, res) =>
  sendSuccess(res, { audit: await auditLead(req.auth, req.validated.params.id) }, 201)));
router.get('/:id/website-audits', canRead, validate({ params: v.idParams }), h(async (req, res) =>
  sendSuccess(res, { items: await listLeadAudits(req.auth, req.validated.params.id) })));

router.post('/:id/notes', canWrite, validate({ params: v.idParams, body: v.noteBody }), h(async (req, res) =>
  sendSuccess(res, { note: await leads.addNote(req.auth, req.validated.params.id, req.validated.body.body) }, 201)));
router.delete('/:id/notes/:noteId', canWrite, validate({ params: v.noteParams }), h(async (req, res) =>
  sendSuccess(res, await leads.deleteNote(req.auth, req.validated.params.id, req.validated.params.noteId))));

export default router;
