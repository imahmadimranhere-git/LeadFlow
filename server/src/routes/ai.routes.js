// /api/v1/ai — model list (for AI settings) and the company's AI usage.
import { Router } from 'express';
import authenticate from '../middleware/authenticate.js';
import authorize, { authorizeAny } from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import { z, pagination } from '../validators/common.js';
import { listActiveModels } from '../services/ai/modelPricingService.js';
import { usageSummary, listUsage } from '../services/ai/aiUsageService.js';
import * as scoring from '../services/ai/scoring/leadScoring.js';
import { objectId, idParams } from '../validators/common.js';
import { BATCH_MAX } from '../models/AiBatchJob.js';

const router = Router();
router.use(authenticate);

router.get('/models', authorize(P.TENANT_READ), validate({}), asyncHandler(async (_req, res) => sendSuccess(res, { items: await listActiveModels() })));

const canSeeUsage = authorizeAny(P.BILLING_MANAGE, P.INTEGRATIONS_MANAGE);
router.get('/usage/summary', canSeeUsage, validate({}), asyncHandler(async (req, res) => sendSuccess(res, await usageSummary(req.auth))));
router.get('/usage', canSeeUsage, validate({ query: z.object(pagination).strict() }), asyncHandler(async (req, res) => {
  const q = req.validated.query;
  const { items, total } = await listUsage(q);
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
