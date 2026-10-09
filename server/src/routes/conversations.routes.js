// /api/v1/conversations — threads with leads, logging replies, AI reply suggestions.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import env from '../config/env.js';
import authenticate from '../middleware/authenticate.js';
import authorize, { authorizeAny } from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import * as conversations from '../services/conversations/conversationService.js';
import * as replies from '../services/conversations/replyAssistant.js';
import * as v from '../validators/conversations.validators.js';

const h = asyncHandler;
const router = Router();
router.use(authenticate);

const canRead = authorizeAny(P.LEADS_READ_ALL, P.LEADS_READ_OWN);
const canWrite = authorize(P.LEADS_WRITE);
const canLink = [authorize(P.LEADS_WRITE), authorize(P.LEADS_READ_ALL)]; // unknown senders: managers/admins
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: env.AI_RATE_LIMIT_PER_MINUTE,
  keyGenerator: (req) => `ai:${req.auth.tenantId}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Too many AI requests — please wait a minute.', errors: [] }),
});

router.get('/', canRead, validate({ query: v.listQuery }), h(async (req, res) => {
  const q = req.validated.query;
  const { items, total } = await conversations.listConversations(req.auth, { ...q, unreadOnly: q.unread });
  sendPaginated(res, items, { page: q.page, limit: q.limit, total });
}));
router.post('/', canWrite, validate({ body: v.startBody }), h(async (req, res) => sendSuccess(res, { conversation: await conversations.startConversation(req.auth, req.validated.body) }, 201)));
router.get('/:id', canRead, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, await conversations.getConversation(req.auth, req.validated.params.id))));
router.post('/:id/read', canRead, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, await conversations.markRead(req.auth, req.validated.params.id))));
router.post('/:id/messages', canWrite, validate({ params: v.idParams, body: v.logBody }), h(async (req, res) => sendSuccess(res, await conversations.logMessage(req.auth, req.validated.params.id, req.validated.body), 201)));
router.patch('/:id/status', canWrite, validate({ params: v.idParams, body: v.statusBody }), h(async (req, res) => sendSuccess(res, { conversation: await conversations.setStatus(req.auth, req.validated.params.id, req.validated.body) })));
router.post('/:id/link', ...canLink, validate({ params: v.idParams, body: v.linkBody }), h(async (req, res) => sendSuccess(res, { conversation: await conversations.linkToLead(req.auth, req.validated.params.id, req.validated.body) })));
router.post('/:id/create-lead', ...canLink, validate({ params: v.idParams, body: v.createLeadBody }), h(async (req, res) => sendSuccess(res, { conversation: await conversations.createLeadFromConversation(req.auth, req.validated.params.id, req.validated.body) }, 201)));
router.post('/:id/suggest-reply', canWrite, aiLimiter, validate({ params: v.idParams, body: v.suggestBody }), h(async (req, res) => sendSuccess(res, { message: await replies.suggestReply(req.auth, req.validated.params.id, req.validated.body) }, 201)));
router.post('/:id/draft-reply', canWrite, validate({ params: v.idParams, body: v.draftBody }), h(async (req, res) => sendSuccess(res, { message: await replies.draftReply(req.auth, req.validated.params.id, req.validated.body) }, 201)));

export default router;
