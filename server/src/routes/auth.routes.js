import { Router } from 'express';
import * as ctrl from '../controllers/auth.controller.js';
import validate from '../middleware/validate.js';
import authenticate, { authenticateAllowBillingOnly } from '../middleware/authenticate.js';
import requireTrustedOrigin from '../middleware/requireTrustedOrigin.js';
import { authLimiter, refreshLimiter } from '../middleware/rateLimiters.js';
import asyncHandler from '../utils/asyncHandler.js';
import * as v from '../validators/auth.validators.js';
import { registerSchema, loginSchema, changePasswordSchema } from '../validators/auth.validators.js';
import rateLimit from 'express-rate-limit';

const router = Router();

router.post('/register', authLimiter, validate({ body: registerSchema }), asyncHandler(ctrl.register));
router.post('/login', authLimiter, validate({ body: loginSchema }), asyncHandler(ctrl.login));

// Cookie-based endpoints → CSRF origin check
router.post('/refresh', refreshLimiter, requireTrustedOrigin, validate({}), asyncHandler(ctrl.refresh));
router.post('/logout', requireTrustedOrigin, validate({}), asyncHandler(ctrl.logout));

// Access-token endpoints
router.post('/logout-all', authenticateAllowBillingOnly, validate({}), asyncHandler(ctrl.logoutAll));
router.get('/me', authenticateAllowBillingOnly, validate({}), asyncHandler(ctrl.me));
router.post('/change-password', authLimiter, authenticate, validate({ body: changePasswordSchema }), asyncHandler(ctrl.changePassword));

// ---- Phase 27: account security
// "forgot password" also limited per EMAIL (so one address can't be flooded from many IPs) — plus max 3 links/hour in the service
const perEmail = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => `forgot:${String(req.body?.email || '').toLowerCase().slice(0, 254)}`, // security-scan: ignore (rate-limit key only; body validated next)
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Too many attempts, please try again later.', errors: [] }),
});
router.post('/login/mfa', authLimiter, validate({ body: v.loginMfaSchema }), asyncHandler(ctrl.loginMfa));
router.post('/forgot-password', authLimiter, perEmail, validate({ body: v.forgotPasswordSchema }), asyncHandler(ctrl.forgotPassword));
router.post('/reset-password', authLimiter, validate({ body: v.resetPasswordSchema }), asyncHandler(ctrl.resetPassword));
router.post('/verify-email', authLimiter, validate({ body: v.verifyEmailSchema }), asyncHandler(ctrl.verifyEmail));

router.post('/resend-verification', authLimiter, authenticateAllowBillingOnly, validate({}), asyncHandler(ctrl.resendVerification));
router.get('/security', authenticateAllowBillingOnly, validate({}), asyncHandler(ctrl.securityStatus));
router.get('/sessions', authenticateAllowBillingOnly, validate({}), asyncHandler(ctrl.listSessions));
router.delete('/sessions/:id', authenticateAllowBillingOnly, validate({ params: v.sessionParams }), asyncHandler(ctrl.revokeSession));
router.post('/mfa/setup', authLimiter, authenticateAllowBillingOnly, validate({ body: v.mfaSetupSchema }), asyncHandler(ctrl.mfaSetup));
router.post('/mfa/enable', authLimiter, authenticateAllowBillingOnly, validate({ body: v.mfaEnableSchema }), asyncHandler(ctrl.mfaEnable));
router.post('/mfa/disable', authLimiter, authenticateAllowBillingOnly, validate({ body: v.mfaDisableSchema }), asyncHandler(ctrl.mfaDisable));
router.post('/mfa/recovery-codes', authLimiter, authenticateAllowBillingOnly, validate({ body: v.mfaRecoverySchema }), asyncHandler(ctrl.mfaRecoveryCodes));

export default router;
