// /api/v1/discovery — find new leads from official search APIs. Needs leads:write.
import { Router } from 'express';
import authenticate from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import * as discovery from '../services/leads/discovery/discoveryService.js';
import * as v from '../validators/discovery.validators.js';

const router = Router();
router.use(authenticate, authorize(P.LEADS_WRITE));
const h = asyncHandler;

router.get('/sources', validate({}), h(async (req, res) => sendSuccess(res, { items: await discovery.listSources(req.auth) })));
router.get('/queries', validate({ query: v.queriesQuery }), h(async (req, res) => sendSuccess(res, { items: await discovery.suggestQueries(req.validated.query.source) })));

router.post('/runs', validate({ body: v.createRunBody }), h(async (req, res) => sendSuccess(res, { run: await discovery.createRun(req.auth, req.validated.body) }, 201)));
router.get('/runs', validate({ query: v.runsQuery }), h(async (req, res) => {
  const q = req.validated.query;
  const { items, total } = await discovery.listRuns(q);
  sendPaginated(res, items, { page: q.page, limit: q.limit, total });
}));
router.get('/runs/:id', validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, { run: await discovery.getRun(req.validated.params.id) })));
router.post('/runs/:id/cancel', validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, { run: await discovery.cancelRun(req.auth, req.validated.params.id) })));
router.get('/runs/:id/candidates', validate({ params: v.idParams, query: v.candidatesQuery }), h(async (req, res) => {
  const q = req.validated.query;
  const { items, total } = await discovery.listCandidates(req.validated.params.id, q);
  sendPaginated(res, items, { page: q.page, limit: q.limit, total });
}));

router.post('/candidates/import', validate({ body: v.candidateIdsBody }), h(async (req, res) => sendSuccess(res, await discovery.importCandidates(req.auth, req.validated.body.ids))));
router.post('/candidates/dismiss', validate({ body: v.candidateIdsBody }), h(async (req, res) => sendSuccess(res, await discovery.dismissCandidates(req.validated.body.ids))));

export default router;
