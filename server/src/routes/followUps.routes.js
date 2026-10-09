// /api/v1/follow-ups and /api/v1/notifications
import { Router } from 'express';
import authenticate from '../middleware/authenticate.js';
import authorize, { authorizeAny } from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import * as followUps from '../services/followUps/followUpService.js';
import * as notifications from '../services/notifications/notificationService.js';
import * as v from '../validators/followUps.validators.js';

const h = asyncHandler;

// ---------------------------------------------------------------- follow-ups
export const followUpRouter = Router();
followUpRouter.use(authenticate);
const canRead = authorizeAny(P.LEADS_READ_ALL, P.LEADS_READ_OWN);
const canWrite = authorize(P.LEADS_WRITE);

followUpRouter.get('/', canRead, validate({ query: v.listQuery }), h(async (req, res) => {
  const q = req.validated.query;
  const { items, total } = await followUps.listFollowUps(req.auth, q);
  sendPaginated(res, items, { page: q.page, limit: q.limit, total });
}));
followUpRouter.get('/summary', canRead, validate({ query: v.summaryQuery }), h(async (req, res) => sendSuccess(res, await followUps.followUpSummary(req.auth, req.validated.query))));
followUpRouter.get('/:leadId', canRead, validate({ params: v.leadParams }), h(async (req, res) => sendSuccess(res, await followUps.getFollowUp(req.auth, req.validated.params.leadId))));
followUpRouter.put('/:leadId', canWrite, validate({ params: v.leadParams, body: v.setBody }), h(async (req, res) => sendSuccess(res, await followUps.setFollowUp(req.auth, req.validated.params.leadId, req.validated.body))));
followUpRouter.post('/:leadId/done', canWrite, validate({ params: v.leadParams, body: v.doneBody }), h(async (req, res) => sendSuccess(res, await followUps.completeFollowUp(req.auth, req.validated.params.leadId, req.validated.body))));
followUpRouter.delete('/:leadId', canWrite, validate({ params: v.leadParams }), h(async (req, res) => sendSuccess(res, await followUps.clearFollowUp(req.auth, req.validated.params.leadId))));

// ---------------------------------------------------------------- notifications (every user: only their own)
export const notificationRouter = Router();
notificationRouter.use(authenticate);

notificationRouter.get('/', validate({ query: v.notificationsQuery }), h(async (req, res) => {
  const q = req.validated.query;
  const { items, total, unreadCount } = await notifications.listNotifications(req.auth, q);
  res.status(200).json({ success: true, data: { items, unreadCount, pagination: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) } } });
}));
notificationRouter.get('/unread-count', validate({}), h(async (req, res) => sendSuccess(res, await notifications.unreadCount(req.auth))));
notificationRouter.post('/read-all', validate({}), h(async (req, res) => sendSuccess(res, await notifications.markAllRead(req.auth))));
notificationRouter.get('/preferences', validate({}), h(async (req, res) => sendSuccess(res, await notifications.getPreferences(req.auth))));
notificationRouter.patch('/preferences', validate({ body: v.prefsBody }), h(async (req, res) => sendSuccess(res, await notifications.updatePreferences(req.auth, req.validated.body))));
notificationRouter.post('/:id/read', validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, { notification: await notifications.markRead(req.auth, req.validated.params.id) })));
