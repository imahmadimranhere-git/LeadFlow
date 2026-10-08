// /api/v1/extension — the Chrome extension's API.
//  public:            POST /pair, POST /token          (strict rate limits)
//  extension token:   GET /me, POST /check, POST /leads, POST /leads/:id/sources, POST /logout
//  web app (normal login): POST /pairing-codes, GET /sessions, DELETE /sessions/:id
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import env from '../config/env.js';
import authenticate from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { requestMeta } from '../utils/requestMeta.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import * as extAuth from '../services/extension/extensionAuthService.js';
import * as extLeads from '../services/extension/extensionLeadService.js';
import * as v from '../validators/extension.validators.js';

const router = Router();
const h = asyncHandler;
const tooMany = (_req, res) => res.status(429).json({ success: false, message: 'Too many requests — please wait a few minutes.', errors: [] });

// ---- public (no login yet)
// (AUTH_RATE_LIMIT_MAX defaults to 30 → ~10 pairing tries per 15 min per IP)
const pairLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: Math.max(5, Math.floor(env.AUTH_RATE_LIMIT_MAX / 3)), standardHeaders: 'draft-7', legacyHeaders: false, handler: tooMany });
const tokenLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: env.AUTH_RATE_LIMIT_MAX * 2, standardHeaders: 'draft-7', legacyHeaders: false, handler: tooMany });

router.post('/pair', pairLimiter, validate({ body: v.pairBody }), h(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  sendSuccess(res, await extAuth.pairExtension(req.validated.body, requestMeta(req)));
}));
router.post('/token', tokenLimiter, validate({ body: v.tokenBody }), h(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  sendSuccess(res, await extAuth.refreshExtensionToken(req.validated.body.refreshToken, requestMeta(req)));
}));

// ---- web app: pairing codes + connected browsers (normal login)
router.post('/pairing-codes', authenticate, authorize(P.LEADS_WRITE), validate({}), h(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  sendSuccess(res, await extAuth.createPairingCode(req.auth), 201);
}));
router.get('/sessions', authenticate, authorize(P.LEADS_WRITE), validate({}), h(async (req, res) => sendSuccess(res, { items: await extAuth.listSessions(req.auth) })));
router.delete('/sessions/:id', authenticate, authorize(P.LEADS_WRITE), validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, await extAuth.revokeSession(req.auth, req.validated.params.id))));

// ---- extension token only (separate rate limit per connected browser)
const extLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (req) => `ext:${req.auth?.extensionSessionId || 'none'}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: tooMany,
});
const ext = [extAuth.authenticateExtension, extLimiter];

router.get('/me', ...ext, validate({}), h(async (req, res) => sendSuccess(res, await extLeads.extensionMe(req.auth))));
router.post('/check', ...ext, validate({ body: v.checkBody }), h(async (req, res) => sendSuccess(res, await extLeads.checkPage(req.auth, req.validated.body))));
router.post('/leads', ...ext, validate({ body: v.saveLeadBody }), h(async (req, res) => sendSuccess(res, await extLeads.saveFromExtension(req.auth, req.validated.body), 201)));
router.post('/leads/:id/sources', ...ext, validate({ params: v.idParams, body: v.addSourceBody }), h(async (req, res) => sendSuccess(res, await extLeads.addPageAsSource(req.auth, req.validated.params.id, req.validated.body))));
router.post('/logout', ...ext, validate({}), h(async (req, res) => sendSuccess(res, await extAuth.logoutExtension(req.auth))));

export default router;
