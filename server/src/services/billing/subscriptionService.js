// Subscription lifecycle:
//   TRIALING ──trial ends──▶ PAST_DUE ──grace ends──▶ SUSPENDED (owner can still open Billing and pay)
//   ACTIVE ──period ends──▶ (renewal invoice) PAST_DUE ──paid──▶ ACTIVE
//   any ──invoice paid──▶ ACTIVE        ACTIVE + cancelAtPeriodEnd ──period ends──▶ CANCELLED
// Every transition is an atomic "only if still in status X" update → safe if the job runs twice.
import Subscription from '../../models/Subscription.js';
import Plan from '../../models/Plan.js';
import Tenant from '../../models/Tenant.js';
import PlatformInvoice from '../../models/PlatformInvoice.js';
import Payment from '../../models/Payment.js';
import { nextSequence } from '../../models/Counter.js';
import ApiError from '../../utils/ApiError.js';
import { recordAudit } from '../audit/auditService.js';
import { addBillingCycle, addDays } from './dates.js';
import { getBillingSettings } from './settingsService.js';
import { getProvider } from './providers/index.js';
import { getUsage } from './quotaService.js';
import { buildPagination } from '../../utils/queryBuilder.js';

export const TENANT_STATUS_FOR = {
  TRIALING: 'TRIAL',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  SUSPENDED: 'SUSPENDED',
  CANCELLED: 'CANCELLED',
};
const SUB_STATUS_FOR_TENANT = Object.fromEntries(Object.entries(TENANT_STATUS_FOR).map(([k, v]) => [v, k]));

export const priceFor = (plan, cycle) => (cycle === 'YEARLY' ? plan.priceYearlyMinor : plan.priceMonthlyMinor);

async function nextInvoiceNumber(now = new Date()) {
  const year = now.getUTCFullYear();
  const seq = await nextSequence(`invoice-${year}`);
  return `INV-${year}-${String(seq).padStart(6, '0')}`;
}

/** Tenant.status is the access switch. Billing never overrides an ADMIN suspension. */
async function syncTenant(tenantId, subStatus, reason = null) {
  const set = { status: TENANT_STATUS_FOR[subStatus], statusChangedAt: new Date() };
  if (subStatus === 'SUSPENDED') {
    set.suspensionType = 'NON_PAYMENT';
    set.statusReason = reason || 'Payment overdue';
  } else {
    set.suspensionType = null;
  }
  await Tenant.updateOne({ _id: tenantId, suspensionType: { $ne: 'ADMIN' } }, { $set: set });
}

async function transition(subId, fromStatuses, toStatus, extraSet = {}, reason = null) {
  const sub = await Subscription.findOneAndUpdate(
    { _id: subId, status: { $in: fromStatuses } },
    { $set: { status: toStatus, ...extraSet } },
    { new: true }
  );
  if (!sub) return null; // someone else already moved it
  await syncTenant(sub.tenantId, toStatus, reason);
  await recordAudit({
    actorType: 'SYSTEM', tenantId: sub.tenantId, action: 'subscription.status_changed',
    targetType: 'Subscription', targetId: sub._id, metadata: { from: fromStatuses.join('|'), to: toStatus, reason },
  });
  return sub;
}

// ---------------------------------------------------------------- creation

export async function createInitialSubscription(tenant, plan) {
  return Subscription.create({
    tenantId: tenant._id,
    planId: plan._id,
    status: 'TRIALING',
    billingCycle: 'MONTHLY',
    trialEndsAt: tenant.trialEndsAt,
    currentPeriodStart: new Date(),
    currentPeriodEnd: tenant.trialEndsAt,
  });
}

/** Tenants created before Phase 6 get a subscription the first time billing is touched. */
export async function ensureSubscription(tenantId) {
  const existing = await Subscription.findOne({ tenantId });
  if (existing) return existing;

  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw ApiError.notFound('Tenant not found');
  let plan = tenant.planId ? await Plan.findById(tenant.planId) : null;
  if (!plan) plan = await Plan.findOne({ code: 'free-trial' });
  if (!plan) return null; // platform has no plans yet

  const now = new Date();
  const status = SUB_STATUS_FOR_TENANT[tenant.status] || 'TRIALING';
  const trialEndsAt = tenant.trialEndsAt || addDays(now, plan.trialDays || 14);
  try {
    return await Subscription.create({
      tenantId: tenant._id,
      planId: plan._id,
      status,
      billingCycle: 'MONTHLY',
      trialEndsAt,
      currentPeriodStart: now,
      currentPeriodEnd: status === 'TRIALING' ? trialEndsAt : addBillingCycle(now, 'MONTHLY'),
    });
  } catch (err) {
    if (err.code === 11000) return Subscription.findOne({ tenantId });
    throw err;
  }
}

// ---------------------------------------------------------------- tenant side

export async function listPublicPlans() {
  const plans = await Plan.find({ isActive: true, isPublic: true }).sort({ sortOrder: 1 }).limit(50);
  return plans.map((p) => {
    const j = p.toJSON();
    return {
      id: j.id, code: j.code, name: j.name, description: j.description, currency: j.currency,
      priceMonthlyMinor: j.priceMonthlyMinor, priceYearlyMinor: j.priceYearlyMinor,
      limits: j.limits, connectors: j.connectors, erpModules: j.erpModules,
    };
  });
}

export async function getBillingOverview(tenantId) {
  const sub = await ensureSubscription(tenantId);
  if (!sub) return { configured: false };
  const [plan, openInvoices, usage, settings] = await Promise.all([
    Plan.findById(sub.planId),
    PlatformInvoice.find({ tenantId, status: 'OPEN' }).sort({ createdAt: -1 }).limit(10).populate('planId', 'name code'),
    getUsage(tenantId),
    getBillingSettings(),
  ]);
  return {
    configured: true,
    subscription: sub.toJSON(),
    plan: plan ? plan.toJSON() : null,
    openInvoices: openInvoices.map((i) => i.toJSON()),
    paymentInstructions: openInvoices.length ? settings.manualPaymentInstructions : null,
    usage,
  };
}

export async function listTenantInvoices(tenantId, { page, limit }) {
  const { skip } = buildPagination(page, limit);
  const [items, total] = await Promise.all([
    PlatformInvoice.find({ tenantId }).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('planId', 'name code'),
    PlatformInvoice.countDocuments({ tenantId }),
  ]);
  return { items: items.map((i) => i.toJSON()), total };
}

async function checkoutResponse(invoice, sub) {
  const settings = await getBillingSettings();
  const provider = getProvider(sub.provider) || getProvider('MANUAL');
  return { invoice: invoice.toJSON(), checkout: await provider.createCheckout({ invoice, settings }) };
}

/** Customer picks a plan → we create an invoice (price from the PLAN, never from the browser). */
export async function checkout(tenantId, { planId, billingCycle }, actor) {
  const sub = await ensureSubscription(tenantId);
  if (!sub) throw ApiError.badRequest('Billing is not set up yet. Please contact support.');

  const plan = await Plan.findById(planId);
  const isCurrentPlan = plan && String(plan._id) === String(sub.planId);
  if (!plan || !plan.isActive || (!plan.isPublic && !isCurrentPlan)) throw ApiError.badRequest('This plan is not available');

  const amount = priceFor(plan, billingCycle);
  if (amount <= 0) throw ApiError.badRequest('This plan has custom pricing. Please contact us.');
  if (sub.status === 'ACTIVE' && isCurrentPlan && sub.billingCycle === billingCycle) {
    throw ApiError.conflict('You are already on this plan');
  }

  const existing = await PlatformInvoice.findOne({ subscriptionId: sub._id, status: 'OPEN', kind: { $in: ['NEW', 'UPGRADE'] } });
  if (existing) {
    if (String(existing.planId) === String(plan._id) && existing.billingCycle === billingCycle) return checkoutResponse(existing, sub);
    await PlatformInvoice.updateOne(
      { _id: existing._id, status: 'OPEN' },
      { $set: { status: 'VOID', voidedAt: new Date(), voidReason: 'Replaced by a new plan selection' }, $unset: { openCheckoutKey: 1 } }
    );
  }

  const settings = await getBillingSettings();
  let invoice;
  try {
    invoice = await PlatformInvoice.create({
      tenantId,
      number: await nextInvoiceNumber(),
      subscriptionId: sub._id,
      planId: plan._id,
      kind: sub.status === 'TRIALING' ? 'NEW' : 'UPGRADE',
      billingCycle,
      amountMinor: amount,
      currency: plan.currency,
      description: `${plan.name} plan (${billingCycle.toLowerCase()})`,
      dueDate: addDays(new Date(), settings.invoiceDueDays),
      provider: sub.provider,
      openCheckoutKey: String(sub._id),
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
    // A parallel request (double-click) created it a moment ago → return that one
    const parallel = await PlatformInvoice.findOne({ openCheckoutKey: String(sub._id) });
    if (!parallel) throw err;
    return checkoutResponse(parallel, sub);
  }

  await recordAudit({
    actorType: 'USER', actorId: actor?.userId, tenantId, action: 'billing.checkout_created',
    targetType: 'PlatformInvoice', targetId: invoice._id, metadata: { plan: plan.code, billingCycle, amountMinor: amount },
  });
  return checkoutResponse(invoice, sub);
}

export async function setCancelAtPeriodEnd(tenantId, cancel, reason, actor) {
  const sub = await ensureSubscription(tenantId);
  if (!sub) throw ApiError.badRequest('No subscription found');
  if (!['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(sub.status)) throw ApiError.conflict('Subscription cannot be changed in its current state');
  sub.cancelAtPeriodEnd = cancel;
  sub.cancelReason = cancel ? reason || null : null;
  await sub.save();
  await recordAudit({
    actorType: 'USER', actorId: actor?.userId, tenantId,
    action: cancel ? 'billing.cancel_requested' : 'billing.cancel_withdrawn',
    targetType: 'Subscription', targetId: sub._id, metadata: { reason: reason || null },
  });
  return sub.toJSON();
}

// ---------------------------------------------------------------- payments

async function applyPaidInvoice(invoice) {
  const now = new Date();
  const start = invoice.kind === 'RENEWAL' ? invoice.periodStart : now;
  const end = invoice.kind === 'RENEWAL' ? invoice.periodEnd : addBillingCycle(now, invoice.billingCycle);

  const sub = await Subscription.findOneAndUpdate(
    { _id: invoice.subscriptionId },
    {
      $set: {
        planId: invoice.planId, billingCycle: invoice.billingCycle, status: 'ACTIVE',
        currentPeriodStart: start, currentPeriodEnd: end, graceEndsAt: null, lastPaymentAt: now,
        cancelAtPeriodEnd: false, cancelledAt: null,
      },
    },
    { new: true }
  );
  if (invoice.kind !== 'RENEWAL') {
    await PlatformInvoice.updateOne({ _id: invoice._id }, { $set: { periodStart: start, periodEnd: end } });
    // a plan change replaces any unpaid renewal
    await PlatformInvoice.updateMany(
      { subscriptionId: invoice.subscriptionId, status: 'OPEN', _id: { $ne: invoice._id } },
      { $set: { status: 'VOID', voidedAt: now, voidReason: 'Superseded by a paid plan change' }, $unset: { openCheckoutKey: 1 } }
    );
  }
  await Tenant.updateOne({ _id: sub.tenantId }, { $set: { planId: invoice.planId } });
  await syncTenant(sub.tenantId, 'ACTIVE');
  return sub;
}

/**
 * Marks an invoice paid exactly once. Used by "Mark as paid" (manual) and by gateway webhooks.
 * providerPaymentId is the idempotency key: the same payment can't be applied twice.
 */
export async function markInvoicePaid({
  invoiceId, invoiceNumber, provider, providerPaymentId, method = 'OTHER', reference = null,
  amountMinor, currency, recordedBy = null, note = null,
}) {
  const invoice = await PlatformInvoice.findOne(invoiceId ? { _id: invoiceId } : { number: invoiceNumber });
  if (!invoice) throw ApiError.notFound('Invoice not found');

  if (invoice.status === 'PAID') {
    const same = await Payment.findOne({ provider, providerPaymentId });
    if (same) return { invoice: invoice.toJSON(), alreadyPaid: true };
    throw ApiError.conflict('Invoice is already paid');
  }
  if (invoice.status !== 'OPEN') throw ApiError.conflict('Invoice is not open');
  if (amountMinor !== undefined && (amountMinor !== invoice.amountMinor || currency !== invoice.currency)) {
    throw ApiError.badRequest('Payment amount does not match the invoice');
  }

  let payment;
  try {
    payment = await Payment.create({
      tenantId: invoice.tenantId, invoiceId: invoice._id, amountMinor: invoice.amountMinor, currency: invoice.currency,
      provider, providerPaymentId, method, reference, recordedBy, note,
    });
  } catch (err) {
    if (err.code === 11000) return { invoice: (await PlatformInvoice.findById(invoice._id)).toJSON(), alreadyPaid: true };
    throw err;
  }

  const paid = await PlatformInvoice.findOneAndUpdate(
    { _id: invoice._id, status: 'OPEN' },
    { $set: { status: 'PAID', paidAt: new Date(), paymentMethod: method, paymentReference: reference, provider }, $unset: { openCheckoutKey: 1 } },
    { new: true }
  );
  if (!paid) {
    await Payment.deleteOne({ _id: payment._id }); // a different payment won the race
    throw ApiError.conflict('Invoice was already paid');
  }

  await applyPaidInvoice(paid);
  await recordAudit({
    actorType: recordedBy ? 'PLATFORM_ADMIN' : 'SYSTEM', actorId: recordedBy, tenantId: paid.tenantId,
    action: 'billing.invoice_paid', targetType: 'PlatformInvoice', targetId: paid._id,
    metadata: { number: paid.number, amountMinor: paid.amountMinor, currency: paid.currency, provider, method },
  });
  return { invoice: paid.toJSON(), alreadyPaid: false };
}

// ---------------------------------------------------------------- scheduled job

export async function runBillingCycle(now = new Date()) {
  const settings = await getBillingSettings();
  const grace = settings.graceDays;
  const summary = { trialsEnded: 0, cancelled: 0, renewalsInvoiced: 0, autoRenewed: 0, suspended: 0 };

  // 1) trials that ended
  for (const sub of await Subscription.find({ status: 'TRIALING', trialEndsAt: { $lte: now } }).limit(500)) {
    if (sub.cancelAtPeriodEnd) {
      if (await transition(sub._id, ['TRIALING'], 'CANCELLED', { cancelledAt: now }, 'Trial ended (cancelled)')) summary.cancelled += 1;
    } else if (await transition(sub._id, ['TRIALING'], 'PAST_DUE', { graceEndsAt: addDays(sub.trialEndsAt, grace) }, 'Trial ended')) {
      summary.trialsEnded += 1;
    }
  }

  // 2) paid periods that ended
  for (const sub of await Subscription.find({ status: 'ACTIVE', currentPeriodEnd: { $lte: now } }).limit(500)) {
    if (sub.cancelAtPeriodEnd) {
      if (await transition(sub._id, ['ACTIVE'], 'CANCELLED', { cancelledAt: now }, 'Cancelled at period end')) summary.cancelled += 1;
      continue;
    }
    const plan = await Plan.findById(sub.planId);
    const amount = plan ? priceFor(plan, sub.billingCycle) : 0;
    const periodStart = sub.currentPeriodEnd;
    const periodEnd = addBillingCycle(periodStart, sub.billingCycle);

    if (!plan || amount <= 0) {
      // free or custom-priced plans renew automatically
      const r = await Subscription.updateOne(
        { _id: sub._id, status: 'ACTIVE', currentPeriodEnd: sub.currentPeriodEnd },
        { $set: { currentPeriodStart: periodStart, currentPeriodEnd: periodEnd } }
      );
      if (r.modifiedCount) summary.autoRenewed += 1;
      continue;
    }

    try {
      await PlatformInvoice.create({
        tenantId: sub.tenantId, number: await nextInvoiceNumber(now), subscriptionId: sub._id, planId: plan._id,
        kind: 'RENEWAL', billingCycle: sub.billingCycle, amountMinor: amount, currency: plan.currency,
        description: `${plan.name} plan renewal (${sub.billingCycle.toLowerCase()})`,
        periodStart, periodEnd, dueDate: addDays(periodStart, grace), provider: sub.provider,
      });
      summary.renewalsInvoiced += 1;
    } catch (err) {
      if (err.code !== 11000) throw err; // already invoiced by an earlier run
    }
    await transition(sub._id, ['ACTIVE'], 'PAST_DUE', { graceEndsAt: addDays(periodStart, grace) }, 'Renewal payment due');
  }

  // 3) grace period over → suspend (owner can still log in to Billing and pay)
  for (const sub of await Subscription.find({ status: 'PAST_DUE', graceEndsAt: { $lte: now } }).limit(500)) {
    if (await transition(sub._id, ['PAST_DUE'], 'SUSPENDED', {}, 'Payment overdue — grace period ended')) summary.suspended += 1;
  }

  return summary;
}

// ---------------------------------------------------------------- super admin

export async function adminListSubscriptions({ page, limit, status }) {
  const filter = status ? { status } : {};
  const { skip } = buildPagination(page, limit);
  const [items, total] = await Promise.all([
    Subscription.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).populate('planId', 'name code').populate('tenantId', 'name slug status'),
    Subscription.countDocuments(filter),
  ]);
  return { items: items.map((s) => s.toJSON()), total };
}

export async function adminTenantBilling(tenantId) {
  const sub = await ensureSubscription(tenantId);
  const [invoices, payments] = await Promise.all([
    PlatformInvoice.find({ tenantId }).sort({ createdAt: -1 }).limit(50).populate('planId', 'name code'),
    Payment.find({ tenantId }).sort({ createdAt: -1 }).limit(50),
  ]);
  return {
    subscription: sub ? (await sub.populate('planId', 'name code')).toJSON() : null,
    invoices: invoices.map((i) => i.toJSON()),
    payments: payments.map((p) => p.toJSON()),
  };
}

export async function adminOverrideSubscription(admin, tenantId, { planId, status, billingCycle, currentPeriodEnd, reason }, meta) {
  const sub = await ensureSubscription(tenantId);
  if (!sub) throw ApiError.badRequest('No plans exist yet — run the seed first');
  const plan = await Plan.findById(planId);
  if (!plan) throw ApiError.badRequest('Plan not found');

  const before = { planId: String(sub.planId), status: sub.status, billingCycle: sub.billingCycle };
  sub.planId = plan._id;
  sub.status = status;
  sub.billingCycle = billingCycle;
  sub.currentPeriodStart = new Date();
  sub.currentPeriodEnd = currentPeriodEnd;
  if (status === 'TRIALING') sub.trialEndsAt = currentPeriodEnd;
  sub.graceEndsAt = status === 'PAST_DUE' ? currentPeriodEnd : null;
  sub.cancelledAt = status === 'CANCELLED' ? new Date() : null;
  sub.overrideNote = reason;
  await sub.save();

  await Tenant.updateOne({ _id: tenantId }, { $set: { planId: plan._id } });
  await syncTenant(tenantId, status, reason);
  await recordAudit({
    actorType: 'PLATFORM_ADMIN', actorId: admin.adminId, tenantId, action: 'subscription.overridden',
    targetType: 'Subscription', targetId: sub._id,
    metadata: { ...before, toPlan: plan.code, toStatus: status, toCycle: billingCycle, currentPeriodEnd, reason }, ip: meta.ip,
  });
  return (await sub.populate('planId', 'name code')).toJSON();
}

export async function adminListInvoices({ page, limit, status, tenantId }) {
  const filter = {};
  if (status) filter.status = status;
  if (tenantId) filter.tenantId = tenantId;
  const { skip } = buildPagination(page, limit);
  const [items, total] = await Promise.all([
    PlatformInvoice.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('planId', 'name code').populate('tenantId', 'name slug'),
    PlatformInvoice.countDocuments(filter),
  ]);
  return { items: items.map((i) => i.toJSON()), total };
}

export async function adminMarkPaid(admin, invoiceId, { method, reference, note }, meta) {
  const result = await markInvoicePaid({
    invoiceId, provider: 'MANUAL', providerPaymentId: `manual:${invoiceId}`, method, reference, note, recordedBy: admin.adminId,
  });
  if (!result.alreadyPaid) {
    await recordAudit({
      actorType: 'PLATFORM_ADMIN', actorId: admin.adminId, tenantId: result.invoice.tenantId,
      action: 'billing.invoice_marked_paid', targetType: 'PlatformInvoice', targetId: invoiceId,
      metadata: { method, reference }, ip: meta.ip,
    });
  }
  return result;
}

export async function adminVoidInvoice(admin, invoiceId, reason, meta) {
  const inv = await PlatformInvoice.findOneAndUpdate(
    { _id: invoiceId, status: 'OPEN' },
    { $set: { status: 'VOID', voidedAt: new Date(), voidReason: reason }, $unset: { openCheckoutKey: 1 } },
    { new: true }
  );
  if (!inv) throw ApiError.conflict('Only open invoices can be voided');
  await recordAudit({
    actorType: 'PLATFORM_ADMIN', actorId: admin.adminId, tenantId: inv.tenantId, action: 'billing.invoice_voided',
    targetType: 'PlatformInvoice', targetId: inv._id, metadata: { number: inv.number, reason }, ip: meta.ip,
  });
  return inv.toJSON();
}

/** MRR per currency (yearly plans count as 1/12 per month), revenue and churn for the dashboard. */
export async function platformRevenueMetrics(now = new Date()) {
  const since = addDays(now, -30);
  const [subs, payments, churned] = await Promise.all([
    Subscription.find({ status: { $in: ['ACTIVE', 'PAST_DUE'] } }).populate('planId', 'priceMonthlyMinor priceYearlyMinor currency').limit(20000),
    Payment.find({ status: 'SUCCEEDED', createdAt: { $gte: since } }).select('amountMinor currency').limit(20000),
    Subscription.countDocuments({ status: 'CANCELLED', cancelledAt: { $gte: since } }),
  ]);
  const mrr = {};
  for (const s of subs) {
    const p = s.planId;
    if (!p) continue;
    const monthly = s.billingCycle === 'YEARLY' ? Math.round(p.priceYearlyMinor / 12) : p.priceMonthlyMinor;
    if (monthly > 0) mrr[p.currency] = (mrr[p.currency] || 0) + monthly;
  }
  const revenue30d = {};
  for (const pay of payments) revenue30d[pay.currency] = (revenue30d[pay.currency] || 0) + pay.amountMinor;
  return { mrr, revenue30d, churn30d: churned, payingSubscriptions: subs.length };
}
