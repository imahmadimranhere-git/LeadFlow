// /api/v1/analytics — company-wide numbers → only roles that see ALL leads (owner, admin, manager, viewer).
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import authenticate from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import * as analytics from '../services/analytics/analyticsService.js';
import * as v from '../validators/analytics.validators.js';

const router = Router();
// heavy queries → a small per-company limit protects the database
const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: (req) => `analytics:${req.auth.tenantId}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Too many analytics requests — wait a minute.', errors: [] }),
});
router.use(authenticate, authorize(P.LEADS_READ_ALL), limiter);
router.get('/overview', validate({ query: v.rangeQuery }), asyncHandler(async (req, res) => sendSuccess(res, await analytics.overview(req.validated.query))));
router.get('/outreach', validate({ query: v.rangeQuery }), asyncHandler(async (req, res) => sendSuccess(res, await analytics.outreachStats(req.validated.query))));

export default router;
