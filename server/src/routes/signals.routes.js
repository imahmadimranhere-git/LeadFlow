// /api/v1/hashtag-watches and /api/v1/signals
import { Router } from 'express';
import authenticate from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import * as watches from '../services/signals/watchService.js';
import * as signals from '../services/signals/signalService.js';
import * as v from '../validators/signals.validators.js';

const h = asyncHandler;

// ---- Hashtag watches: everyone who works leads can SEE them; managers+ change them (they spend quota)
export const watchRouter = Router();
watchRouter.use(authenticate, authorize(P.LEADS_WRITE));
watchRouter.get('/', validate({}), h(async (_req, res) => sendSuccess(res, { items: await watches.listWatches() })));
watchRouter.get('/usage', validate({}), h(async (_req, res) => sendSuccess(res, await watches.getIgHashtagUsage())));
watchRouter.post('/', authorize(P.WATCHES_MANAGE), validate({ body: v.createWatchBody }), h(async (req, res) => sendSuccess(res, { watch: await watches.createWatch(req.auth, req.validated.body) }, 201)));
watchRouter.patch('/:id', authorize(P.WATCHES_MANAGE), validate({ params: v.idParams, body: v.updateWatchBody }), h(async (req, res) => sendSuccess(res, { watch: await watches.updateWatch(req.auth, req.validated.params.id, req.validated.body) })));
watchRouter.delete('/:id', authorize(P.WATCHES_MANAGE), validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, await watches.deleteWatch(req.auth, req.validated.params.id))));
watchRouter.post('/:id/run', authorize(P.WATCHES_MANAGE), validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, { watch: await watches.runWatchNow(req.validated.params.id) })));

// ---- Signals inbox
export const signalRouter = Router();
signalRouter.use(authenticate, authorize(P.LEADS_WRITE));
signalRouter.get('/', validate({ query: v.listSignalsQuery }), h(async (req, res) => {
  const q = req.validated.query;
  const { items, total } = await signals.listSignals(q);
  sendPaginated(res, items, { page: q.page, limit: q.limit, total });
}));
signalRouter.post('/dismiss', validate({ body: v.signalIdsBody }), h(async (req, res) => sendSuccess(res, await signals.dismissSignals(req.validated.body.ids))));
signalRouter.get('/:id', validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, { signal: await signals.getSignal(req.validated.params.id) })));
signalRouter.post('/:id/convert', validate({ params: v.idParams, body: v.convertSignalBody }), h(async (req, res) => {
  const lead = await signals.convertSignal(req.auth, req.validated.params.id, req.validated.body);
  sendSuccess(res, { lead: lead.toJSON() }, 201);
}));
