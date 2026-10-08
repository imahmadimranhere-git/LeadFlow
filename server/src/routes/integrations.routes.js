// /api/v1/integrations — the company's API keys. Owners & admins only (integrations:manage).
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import env from '../config/env.js';
import authenticate from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import * as vault from '../services/integrations/vaultService.js';
import { providerParams, statusBody, validateSaveBody } from '../validators/integrations.validators.js';
import { selectAccountBody, oauthCallbackQuery } from '../validators/signals.validators.js';
import { startMetaOAuth, handleMetaCallback, selectInstagramAccount, appRedirect } from '../services/integrations/meta/metaOAuthService.js';
import * as inbound from '../services/signals/inboundWebhookService.js';
import { requestMeta } from '../utils/requestMeta.js';

// ---- PUBLIC: Facebook sends the browser back here (no login header on a redirect).
// Security comes from the single-use, 10-minute, hashed "state" — not from a token.
export const metaCallbackRouter = Router();
metaCallbackRouter.get(
  '/',
  rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }),
  asyncHandler(async (req, res) => {
    const parsed = oauthCallbackQuery.safeParse(req.query || {});
    if (!parsed.success) return res.redirect(302, appRedirect('error', 'invalid_request'));
    const { code, state, error } = parsed.data;
    res.set('Referrer-Policy', 'no-referrer'); // the ?code= must not leak to the next site
    return res.redirect(302, await handleMetaCallback({ code, state, error }, requestMeta(req)));
  })
);

const router = Router();
router.use(authenticate, authorize(P.INTEGRATIONS_MANAGE));

// "Test connection" calls external services → limit per COMPANY (not per IP)
const testLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Math.max(5, Math.floor(env.AUTH_RATE_LIMIT_MAX / 3)),
  keyGenerator: (req) => `tenant:${req.auth.tenantId}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Too many connection tests — please wait a few minutes.', errors: [] }),
});

// ---- Meta (Instagram) login
router.post('/meta/oauth/start', validate({}), asyncHandler(async (req, res) => sendSuccess(res, await startMetaOAuth(req.auth))));
router.put('/meta/account', validate({ body: selectAccountBody }), asyncHandler(async (req, res) => sendSuccess(res, await selectInstagramAccount(req.auth, req.validated.body.igUserId))));

// ---- Inbound webhook (website forms). The secret is shown only in the create/rotate response.
router.get('/inbound-webhook', validate({}), asyncHandler(async (_req, res) => sendSuccess(res, { webhook: await inbound.getInboundWebhook() })));
router.post('/inbound-webhook', validate({}), asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  sendSuccess(res, await inbound.createInboundWebhook(req.auth), 201);
}));
router.post('/inbound-webhook/rotate', validate({}), asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  sendSuccess(res, await inbound.rotateInboundWebhookSecret(req.auth));
}));

router.get('/providers', validate({}), (_req, res) => sendSuccess(res, { items: vault.listProviders() }));
router.get('/', validate({}), asyncHandler(async (_req, res) => sendSuccess(res, { items: await vault.listIntegrations() })));

router.put(
  '/:provider',
  validateSaveBody,
  asyncHandler(async (req, res) =>
    sendSuccess(res, { integration: await vault.saveIntegration(req.auth, req.validated.params.provider, req.validated.body) })
  )
);
router.post(
  '/:provider/test',
  testLimiter,
  validate({ params: providerParams }),
  asyncHandler(async (req, res) => sendSuccess(res, await vault.testIntegration(req.auth, req.validated.params.provider)))
);
router.patch(
  '/:provider/status',
  validate({ params: providerParams, body: statusBody }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, { integration: await vault.setEnabled(req.auth, req.validated.params.provider, req.validated.body.enabled) })
  )
);
router.delete(
  '/:provider',
  validate({ params: providerParams }),
  asyncHandler(async (req, res) => sendSuccess(res, await vault.deleteIntegration(req.auth, req.validated.params.provider)))
);

export default router;
