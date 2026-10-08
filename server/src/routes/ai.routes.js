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

export default router;
