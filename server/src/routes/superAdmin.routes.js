// /api/v1/super-admin/* — separate guard, separate token, strict rate limits, everything audited.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import env from '../config/env.js';
import * as ctrl from '../controllers/superAdmin.controller.js';
import validate from '../middleware/validate.js';
import superAdminAuth from '../middleware/superAdminAuth.js';
import asyncHandler from '../utils/asyncHandler.js';
import * as v from '../validators/superAdmin.validators.js';
import * as bctrl from '../controllers/superAdminBilling.controller.js';
import * as bv from '../validators/billing.validators.js';

const router = Router();

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Math.max(1, Math.floor(env.AUTH_RATE_LIMIT_MAX / 3)),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Too many attempts, please try again later.', errors: [] }),
});

// Public (step 1 + step 2 of login)
router.post('/auth/login', adminLoginLimiter, validate({ body: v.adminLoginBody }), asyncHandler(ctrl.login));
router.post('/auth/mfa', adminLoginLimiter, validate({ body: v.adminMfaBody }), asyncHandler(ctrl.verifyMfa));

// Everything below: valid admin token with MFA completed
router.use(superAdminAuth);

router.get('/auth/me', validate({}), asyncHandler(ctrl.me));
router.post('/auth/change-password', adminLoginLimiter, validate({ body: v.adminChangePasswordBody }), asyncHandler(ctrl.changePassword));

router.get('/dashboard', validate({}), asyncHandler(ctrl.stats));

router.get('/tenants', validate({ query: v.listTenantsQuery }), asyncHandler(ctrl.listTenants));
router.get('/tenants/:id', validate({ params: v.idParams }), asyncHandler(ctrl.getTenant));
router.patch('/tenants/:id/status', validate({ params: v.idParams, body: v.tenantStatusBody }), asyncHandler(ctrl.changeTenantStatus));
router.patch('/tenants/:id/plan', validate({ params: v.idParams, body: v.tenantPlanBody }), asyncHandler(ctrl.assignPlan));
router.delete('/tenants/:id', validate({ params: v.idParams, body: v.tenantDeleteBody }), asyncHandler(ctrl.deleteTenant));

router.get('/plans', validate({}), asyncHandler(ctrl.listPlans));
router.post('/plans', validate({ body: v.createPlanBody }), asyncHandler(ctrl.createPlan));
router.patch('/plans/:id', validate({ params: v.idParams, body: v.updatePlanBody }), asyncHandler(ctrl.updatePlan));

router.get('/audit-logs', validate({ query: v.listAuditQuery }), asyncHandler(ctrl.listAudit));

// ---- billing ----
router.get('/subscriptions', validate({ query: bv.adminSubscriptionsQuery }), asyncHandler(bctrl.listSubscriptions));
router.get('/tenants/:id/billing', validate({ params: bv.idParams }), asyncHandler(bctrl.tenantBilling));
router.post('/tenants/:id/subscription', validate({ params: bv.idParams, body: bv.overrideBody }), asyncHandler(bctrl.overrideSubscription));
router.get('/invoices', validate({ query: bv.adminInvoicesQuery }), asyncHandler(bctrl.listInvoices));
router.post('/invoices/:id/mark-paid', validate({ params: bv.idParams, body: bv.markPaidBody }), asyncHandler(bctrl.markPaid));
router.post('/invoices/:id/void', validate({ params: bv.idParams, body: bv.voidBody }), asyncHandler(bctrl.voidInvoice));
router.get('/settings/billing', validate({}), asyncHandler(bctrl.getBillingSettings));
router.put('/settings/billing', validate({ body: bv.billingSettingsBody }), asyncHandler(bctrl.updateBillingSettings));
router.post('/billing/run-cycle', validate({}), asyncHandler(bctrl.runCycle));

export default router;
