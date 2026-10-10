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
import * as packs from '../services/settings/industryPackAdminService.js';
import { adminIntegrationStatus } from '../services/integrations/vaultService.js';
import * as sv from '../validators/settings.validators.js';
import { sendSuccess } from '../utils/response.js';
import { requestMeta } from '../utils/requestMeta.js';
import * as aiModels from '../services/ai/modelPricingService.js';
import { platformAiUsage } from '../services/superAdmin/aiUsageAdminService.js';
import { snapshot } from '../monitoring/monitorService.js';
import { purgeTenant, listDeletedTenants } from '../services/superAdmin/tenantPurgeService.js';
import Tenant from '../models/Tenant.js';
import ApiError from '../utils/ApiError.js';
import { runAsSystem } from '../utils/tenantContext.js';

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

// ---- integrations: status only, never secrets ----
router.get(
  '/tenants/:id/integrations',
  validate({ params: v.idParams }),
  asyncHandler(async (req, res) => sendSuccess(res, { items: await adminIntegrationStatus(req.validated.params.id) }))
);

// ---- AI models & prices ----
router.get('/ai-models', validate({}), asyncHandler(async (_req, res) => sendSuccess(res, { items: await aiModels.adminListModels() })));
router.post('/ai-models', validate({ body: v.createAiModelBody }), asyncHandler(async (req, res) =>
  sendSuccess(res, { model: await aiModels.adminCreateModel(req.admin, req.validated.body, requestMeta(req)) }, 201)));
router.patch('/ai-models/:id', validate({ params: v.idParams, body: v.updateAiModelBody }), asyncHandler(async (req, res) =>
  sendSuccess(res, { model: await aiModels.adminUpdateModel(req.admin, req.validated.params.id, req.validated.body, requestMeta(req)) })));

// ---- AI usage & cost, all companies (Phase 26) ----
router.get('/ai-usage', validate({ query: v.aiUsageQuery }), asyncHandler(async (req, res) => sendSuccess(res, await platformAiUsage(req.validated.query))));

// ---- System health (Phase 30) — this server's numbers: requests, errors, jobs, DB, memory, alerts ----
router.get('/system', validate({}), asyncHandler(async (_req, res) => sendSuccess(res, await snapshot())));
router.get('/deleted-tenants', validate({}), asyncHandler(async (_req, res) => sendSuccess(res, { items: await listDeletedTenants() })));

// ---- Permanent erasure of a deleted company (Phase 30). Dry run first; real run needs slug + "ERASE". ----
router.post('/tenants/:id/purge', validate({ params: v.idParams, body: v.purgeTenantBody }), asyncHandler(async (req, res) => {
  const { confirmSlug, dryRun } = req.validated.body;
  const t = await runAsSystem('admin:purge:check', () => Tenant.findOne({ _id: req.validated.params.id, deletedAt: { $ne: null } }).select('slug'));
  if (!t) throw ApiError.badRequest('Only a company that has already been deleted can be erased permanently.');
  if (t.slug !== confirmSlug) throw ApiError.badRequest('Confirmation does not match the company slug');
  sendSuccess(res, await purgeTenant(t._id, { dryRun, actor: req.admin.adminId, meta: requestMeta(req) }));
}));

// ---- industry packs ----
router.get('/industry-packs', validate({}), asyncHandler(async (_req, res) => sendSuccess(res, { items: await packs.listAllPacks() })));
router.post(
  '/industry-packs',
  validate({ body: sv.createPackBody }),
  asyncHandler(async (req, res) => sendSuccess(res, { pack: await packs.createPack(req.admin, req.validated.body, requestMeta(req)) }, 201))
);
router.patch(
  '/industry-packs/:id',
  validate({ params: sv.idParams, body: sv.updatePackBody }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, { pack: await packs.updatePack(req.admin, req.validated.params.id, req.validated.body, requestMeta(req)) })
  )
);

export default router;
