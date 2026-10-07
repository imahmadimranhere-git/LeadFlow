import * as subs from '../services/billing/subscriptionService.js';
import * as settings from '../services/billing/settingsService.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { requestMeta } from '../utils/requestMeta.js';

export async function listSubscriptions(req, res) {
  const q = req.validated.query;
  const { items, total } = await subs.adminListSubscriptions(q);
  sendPaginated(res, items, { page: q.page, limit: q.limit, total });
}

export const tenantBilling = async (req, res) => sendSuccess(res, await subs.adminTenantBilling(req.validated.params.id));

export const overrideSubscription = async (req, res) =>
  sendSuccess(res, {
    subscription: await subs.adminOverrideSubscription(req.admin, req.validated.params.id, req.validated.body, requestMeta(req)),
  });

export async function listInvoices(req, res) {
  const q = req.validated.query;
  const { items, total } = await subs.adminListInvoices(q);
  sendPaginated(res, items, { page: q.page, limit: q.limit, total });
}

export const markPaid = async (req, res) =>
  sendSuccess(res, await subs.adminMarkPaid(req.admin, req.validated.params.id, req.validated.body, requestMeta(req)));

export const voidInvoice = async (req, res) =>
  sendSuccess(res, { invoice: await subs.adminVoidInvoice(req.admin, req.validated.params.id, req.validated.body.reason, requestMeta(req)) });

export const getBillingSettings = async (_req, res) => sendSuccess(res, { settings: await settings.getBillingSettings() });
export const updateBillingSettings = async (req, res) =>
  sendSuccess(res, { settings: await settings.updateBillingSettings(req.admin, req.validated.body, requestMeta(req)) });

export const runCycle = async (_req, res) => sendSuccess(res, { summary: await subs.runBillingCycle(new Date()) });
