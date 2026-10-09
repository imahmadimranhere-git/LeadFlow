// /api/v1/messages (drafts + approval queue) and /api/v1/templates
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import env from '../config/env.js';
import authenticate from '../middleware/authenticate.js';
import authorize, { authorizeAny } from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import * as messages from '../services/messages/messageService.js';
import * as templates from '../services/messages/templateService.js';
import * as v from '../validators/messages.validators.js';
import * as outreach from '../services/outreach/outreachService.js';

const h = asyncHandler;
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: env.AI_RATE_LIMIT_PER_MINUTE,
  keyGenerator: (req) => `ai:${req.auth.tenantId}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Too many AI requests — please wait a minute.', errors: [] }),
});

// ---------------------------------------------------------------- messages
export const messageRouter = Router();
messageRouter.use(authenticate);
const canWrite = authorize(P.LEADS_WRITE);
const canRead = authorizeAny(P.LEADS_READ_ALL, P.LEADS_READ_OWN);
const canApprove = authorize(P.MESSAGES_APPROVE);

messageRouter.get('/', canRead, validate({ query: v.listQuery }), h(async (req, res) => {
  const q = req.validated.query;
  const { items, total } = await messages.listMessages(req.auth, q);
  sendPaginated(res, items, { page: q.page, limit: q.limit, total });
}));
messageRouter.post('/generate', canWrite, aiLimiter, validate({ body: v.generateBody }), h(async (req, res) => sendSuccess(res, { message: await messages.generateMessage(req.auth, req.validated.body) }, 201)));
messageRouter.post('/from-template', canWrite, validate({ body: v.fromTemplateBody }), h(async (req, res) => sendSuccess(res, { message: await messages.messageFromTemplate(req.auth, req.validated.body) }, 201)));
messageRouter.post('/manual', canWrite, validate({ body: v.manualBody }), h(async (req, res) => sendSuccess(res, { message: await messages.manualMessage(req.auth, req.validated.body) }, 201)));
messageRouter.get('/:id', canRead, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, { message: await messages.getMessage(req.auth, req.validated.params.id) })));
messageRouter.patch('/:id', canWrite, validate({ params: v.idParams, body: v.editBody }), h(async (req, res) => sendSuccess(res, { message: await messages.editMessage(req.auth, req.validated.params.id, req.validated.body) })));
messageRouter.post('/:id/regenerate', canWrite, aiLimiter, validate({ params: v.idParams, body: v.regenerateBody }), h(async (req, res) => sendSuccess(res, { message: await messages.regenerateMessage(req.auth, req.validated.params.id, req.validated.body) })));
messageRouter.post('/:id/approve', canApprove, validate({ params: v.idParams, body: v.approveBody }), h(async (req, res) => sendSuccess(res, { message: await messages.approveMessage(req.auth, req.validated.params.id, req.validated.body) })));
messageRouter.post('/:id/reject', canApprove, validate({ params: v.idParams, body: v.rejectBody }), h(async (req, res) => sendSuccess(res, { message: await messages.rejectMessage(req.auth, req.validated.params.id, req.validated.body) })));
messageRouter.post('/:id/save-as-template', canApprove, validate({ params: v.idParams, body: v.saveTemplateBody }), h(async (req, res) => sendSuccess(res, { template: await messages.saveMessageAsTemplate(req.auth, req.validated.params.id, req.validated.body) }, 201)));
messageRouter.delete('/:id', canWrite, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, await messages.deleteMessage(req.auth, req.validated.params.id))));

// ---- outreach: send / track (approved messages only)
const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Math.max(30, Math.floor(env.AUTH_RATE_LIMIT_MAX / 2)),
  keyGenerator: (req) => `send:${req.auth.tenantId}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Too many sends — slow down a little.', errors: [] }),
});
messageRouter.get('/:id/send-options', canWrite, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, await outreach.sendOptions(req.auth, req.validated.params.id))));
messageRouter.post('/:id/send-email', canWrite, sendLimiter, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, { message: await outreach.sendEmail(req.auth, req.validated.params.id) })));
messageRouter.post('/:id/send-whatsapp', canWrite, sendLimiter, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, { message: await outreach.sendWhatsApp(req.auth, req.validated.params.id) })));
messageRouter.post('/:id/mark-sent', canWrite, validate({ params: v.idParams, body: v.noteBody }), h(async (req, res) => sendSuccess(res, { message: await outreach.markSent(req.auth, req.validated.params.id, req.validated.body) })));
messageRouter.post('/:id/mark-replied', canWrite, validate({ params: v.idParams, body: v.noteBody }), h(async (req, res) => sendSuccess(res, { message: await outreach.markReplied(req.auth, req.validated.params.id, req.validated.body) })));
messageRouter.post('/:id/follow-up', canWrite, validate({ params: v.idParams, body: v.followUpBody }), h(async (req, res) => sendSuccess(res, { message: await outreach.setFollowUp(req.auth, req.validated.params.id, req.validated.body) })));
messageRouter.post('/:id/close', canWrite, validate({ params: v.idParams, body: v.noteBody }), h(async (req, res) => sendSuccess(res, { message: await outreach.closeMessage(req.auth, req.validated.params.id, req.validated.body) })));

// ---------------------------------------------------------------- templates
export const templateRouter = Router();
templateRouter.use(authenticate, authorize(P.LEADS_WRITE));
const canManage = authorize(P.MESSAGES_APPROVE);

templateRouter.get('/', validate({ query: v.templatesQuery }), h(async (req, res) => sendSuccess(res, { items: await templates.listTemplates({ channel: req.validated.query.channel, includeInactive: req.validated.query.all }) })));
templateRouter.post('/', canManage, validate({ body: v.createTemplateBody }), h(async (req, res) => sendSuccess(res, { template: await templates.createTemplate(req.auth, req.validated.body) }, 201)));
templateRouter.post('/import-starters', canManage, validate({}), h(async (req, res) => sendSuccess(res, await templates.importStarterTemplates(req.auth))));
templateRouter.patch('/:id', canManage, validate({ params: v.idParams, body: v.updateTemplateBody }), h(async (req, res) => sendSuccess(res, { template: await templates.updateTemplate(req.auth, req.validated.params.id, req.validated.body) })));
templateRouter.delete('/:id', canManage, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, await templates.deleteTemplate(req.auth, req.validated.params.id))));
templateRouter.post('/:id/preview', validate({ params: v.idParams, body: v.previewBody }), h(async (req, res) => sendSuccess(res, await templates.previewTemplate(req.auth, req.validated.params.id, req.validated.body.leadId))));
