import { Router } from 'express';
import * as ctrl from '../controllers/auth.controller.js';
import validate from '../middleware/validate.js';
import authenticate, { authenticateAllowBillingOnly } from '../middleware/authenticate.js';
import requireTrustedOrigin from '../middleware/requireTrustedOrigin.js';
import { authLimiter, refreshLimiter } from '../middleware/rateLimiters.js';
import asyncHandler from '../utils/asyncHandler.js';
import { registerSchema, loginSchema, changePasswordSchema } from '../validators/auth.validators.js';

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

export default router;
