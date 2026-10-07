import * as subs from '../services/billing/subscriptionService.js';
import { getUsage } from '../services/billing/quotaService.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';

export const overview = async (req, res) => sendSuccess(res, await subs.getBillingOverview(req.auth.tenantId));
export const usage = async (req, res) => sendSuccess(res, await getUsage(req.auth.tenantId));
export const plans = async (_req, res) => sendSuccess(res, { items: await subs.listPublicPlans() });
export const checkout = async (req, res) => sendSuccess(res, await subs.checkout(req.auth.tenantId, req.validated.body, req.auth), 201);
export const cancel = async (req, res) =>
  sendSuccess(res, { subscription: await subs.setCancelAtPeriodEnd(req.auth.tenantId, true, req.validated.body.reason, req.auth) });
export const resume = async (req, res) =>
  sendSuccess(res, { subscription: await subs.setCancelAtPeriodEnd(req.auth.tenantId, false, null, req.auth) });

export async function invoices(req, res) {
  const q = req.validated.query;
  const { items, total } = await subs.listTenantInvoices(req.auth.tenantId, q);
  sendPaginated(res, items, { page: q.page, limit: q.limit, total });
}
