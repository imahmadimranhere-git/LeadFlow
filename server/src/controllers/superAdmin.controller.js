import * as adminAuth from '../services/superAdmin/adminAuthService.js';
import * as tenantsAdmin from '../services/superAdmin/tenantAdminService.js';
import * as plans from '../services/superAdmin/planService.js';
import * as dashboard from '../services/superAdmin/dashboardService.js';
import * as audit from '../services/audit/auditService.js';
import PlatformAdmin from '../models/PlatformAdmin.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { requestMeta } from '../utils/requestMeta.js';

// ---- auth ----
export const login = async (req, res) => sendSuccess(res, await adminAuth.adminLogin(req.validated.body, requestMeta(req)));
export const verifyMfa = async (req, res) => sendSuccess(res, await adminAuth.adminVerifyMfa(req.validated.body, requestMeta(req)));
export const me = async (req, res) => sendSuccess(res, { admin: (await PlatformAdmin.findById(req.admin.adminId)).toJSON() });
export const changePassword = async (req, res) =>
  sendSuccess(res, await adminAuth.adminChangePassword(req.admin.adminId, req.validated.body, requestMeta(req)));

// ---- dashboard ----
export const stats = async (_req, res) => sendSuccess(res, await dashboard.getPlatformStats());

// ---- tenants ----
export async function listTenants(req, res) {
  const q = req.validated.query;
  const { items, total } = await tenantsAdmin.listTenants(q);
  sendPaginated(res, items, { page: q.page, limit: q.limit, total });
}
export const getTenant = async (req, res) => sendSuccess(res, await tenantsAdmin.getTenant(req.validated.params.id));
export const changeTenantStatus = async (req, res) =>
  sendSuccess(res, {
    tenant: await tenantsAdmin.changeTenantStatus(req.admin, req.validated.params.id, req.validated.body, requestMeta(req)),
  });
export const assignPlan = async (req, res) =>
  sendSuccess(res, { tenant: await tenantsAdmin.assignPlan(req.admin, req.validated.params.id, req.validated.body, requestMeta(req)) });
export const deleteTenant = async (req, res) =>
  sendSuccess(res, await tenantsAdmin.softDeleteTenant(req.admin, req.validated.params.id, req.validated.body, requestMeta(req)));

// ---- plans ----
export const listPlans = async (_req, res) => sendSuccess(res, { items: await plans.listPlans() });
export const createPlan = async (req, res) =>
  sendSuccess(res, { plan: await plans.createPlan(req.admin, req.validated.body, requestMeta(req)) }, 201);
export const updatePlan = async (req, res) =>
  sendSuccess(res, { plan: await plans.updatePlan(req.admin, req.validated.params.id, req.validated.body, requestMeta(req)) });

// ---- audit ----
export async function listAudit(req, res) {
  const q = req.validated.query;
  const { items, total } = await audit.listAuditLogs(q);
  sendPaginated(res, items, { page: q.page, limit: q.limit, total });
}
