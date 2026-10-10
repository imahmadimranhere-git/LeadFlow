// /api/v1/ai — model list (for AI settings) and the company's AI usage.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import authenticate from '../middleware/authenticate.js';
import authorize, { authorizeAny } from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import { z, pagination } from '../validators/common.js';
import { listActiveModels } from '../services/ai/modelPricingService.js';
import { usageSummary, usageReport, listUsage, companyTimezone } from '../services/ai/aiUsageService.js';
import { AI_REQUEST_TYPES, AI_USAGE_STATUSES } from '../config/aiOptions.js';
import * as scoring from '../services/ai/scoring/leadScoring.js';
import { objectId, idParams } from '../validators/common.js';
import { BATCH_MAX } from '../models/AiBatchJob.js';

const router = Router();
router.use(authenticate);

router.get('/models', authorize(P.TENANT_READ), validate({}), asyncHandler(async (_req, res) => sendSuccess(res, { items: await listActiveModels() })));

const canSeeUsage = authorizeAny(P.BILLING_MANAGE, P.INTEGRATIONS_MANAGE);
router.get('/usage/summary', canSeeUsage, validate({}), asyncHandler(async (req, res) => sendSuccess(res, await usageSummary(req.auth))));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), 'Invalid date');
const rangeOk = (d) => !d.from || !d.to || d.from <= d.to;
// Phase 26: full report for a range (max 366 days), and filters on the request list
const reportQuery = z
  .object({ from: day, to: day })
  .strict()
  .refine(rangeOk, { message: '"from" must be before "to"', path: ['from'] })
  .refine((d) => (Date.parse(d.to) - Date.parse(d.from)) / 86400000 <= 366, { message: 'At most 366 days', path: ['to'] });
const listQuery = z
  .object({ ...pagination, requestType: z.enum(AI_REQUEST_TYPES).optional(), status: z.enum(AI_USAGE_STATUSES).optional(), keySource: z.enum(['TENANT', 'PLATFORM']).optional(), userId: objectId.optional(), from: day.optional(), to: day.optional() })
  .strict()
  .refine(rangeOk, { message: '"from" must be before "to"', path: ['from'] });
// heavy aggregation → 30 reports per minute per company
const reportLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, keyGenerator: (req) => `ai-report:${req.auth.tenantId}`, standardHeaders: 'draft-7', legacyHeaders: false, handler: (_req, res) => res.status(429).json({ success: false, message: 'Too many requests — wait a minute.', errors: [] }) });
router.get('/usage/report', canSeeUsage, reportLimiter, validate({ query: reportQuery }), asyncHandler(async (req, res) => sendSuccess(res, await usageReport(req.auth, req.validated.query))));
router.get('/usage', canSeeUsage, validate({ query: listQuery }), asyncHandler(async (req, res) => {
  const q = req.validated.query;
  const { items, total } = await listUsage(q, await companyTimezone());
  sendPaginated(res, items, { page: q.page, limit: q.limit, total });
}));

// ---- lead scoring in the background
const batchBody = z
  .object({
    mode: z.enum(['UNSCORED', 'SELECTED']),
    leadIds: z.array(objectId).max(BATCH_MAX).optional(),
    force: z.boolean().default(false),
  })
  .strict()
  .refine((d) => d.mode !== 'SELECTED' || (d.leadIds && d.leadIds.length > 0), { message: 'Choose leads', path: ['leadIds'] });
const canScore = authorize(P.LEADS_WRITE);
router.post('/scoring/batches', canScore, validate({ body: batchBody }), asyncHandler(async (req, res) => sendSuccess(res, { batch: await scoring.createBatch(req.auth, req.validated.body) }, 201)));
router.get('/scoring/batches', canScore, validate({}), asyncHandler(async (_req, res) => sendSuccess(res, { items: await scoring.listBatches() })));
router.post('/scoring/batches/:id/cancel', canScore, validate({ params: idParams }), asyncHandler(async (req, res) => sendSuccess(res, { batch: await scoring.cancelBatch(req.auth, req.validated.params.id) })));
router.post('/scoring/recalculate', authorize(P.LEADS_ASSIGN), validate({}), asyncHandler(async (req, res) => sendSuccess(res, await scoring.recalculateScores(req.auth))));

export default router;
