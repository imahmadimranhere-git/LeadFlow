// /api/v1/website-audits — recent audits (list page). Running an audit is on the lead: POST /leads/:id/website-audit
import { Router } from 'express';
import authenticate from '../middleware/authenticate.js';
import { authorizeAny } from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendPaginated } from '../utils/response.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import { z, pagination } from '../validators/common.js';
import { listAudits } from '../services/websiteAudit/websiteAuditService.js';

const router = Router();
router.use(authenticate, authorizeAny(P.LEADS_READ_ALL, P.LEADS_READ_OWN));
router.get('/', validate({ query: z.object(pagination).strict() }), asyncHandler(async (req, res) => {
  const q = req.validated.query;
  const { items, total } = await listAudits(req.auth, q);
  sendPaginated(res, items, { page: q.page, limit: q.limit, total });
}));
export default router;
