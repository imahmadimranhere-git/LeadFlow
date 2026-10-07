// Invoices from the platform (you) to a tenant. Amounts are ALWAYS calculated on the server
// from the plan price — never taken from the browser.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import { BILLING_CYCLES, PAYMENT_PROVIDERS } from './Subscription.js';
import { CURRENCIES } from './Plan.js';

export const INVOICE_KINDS = ['NEW', 'UPGRADE', 'RENEWAL', 'MANUAL'];
export const INVOICE_STATUSES = ['OPEN', 'PAID', 'VOID'];

const platformInvoiceSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, maxlength: 40 },
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', required: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
    kind: { type: String, enum: INVOICE_KINDS, required: true },
    status: { type: String, enum: INVOICE_STATUSES, default: 'OPEN' },
    billingCycle: { type: String, enum: BILLING_CYCLES, required: true },
    amountMinor: { type: Number, required: true, min: 0, validate: Number.isInteger },
    currency: { type: String, enum: CURRENCIES, required: true },
    description: { type: String, maxlength: 300, default: '' },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    dueDate: { type: Date, required: true },
    paidAt: { type: Date, default: null },
    voidedAt: { type: Date, default: null },
    voidReason: { type: String, maxlength: 300, default: null },
    provider: { type: String, enum: PAYMENT_PROVIDERS, default: 'MANUAL' },
    paymentMethod: { type: String, maxlength: 40, default: null },
    paymentReference: { type: String, maxlength: 200, default: null },
    // Set ONLY while a plan-change invoice is open → unique index stops duplicate open checkouts (double-click)
    openCheckoutKey: { type: String, default: undefined, private: true },
  },
  { timestamps: true, strict: 'throw' }
);

platformInvoiceSchema.plugin(tenantScopePlugin);
platformInvoiceSchema.index({ number: 1 }, { unique: true });
platformInvoiceSchema.index({ tenantId: 1, createdAt: -1 });
platformInvoiceSchema.index({ status: 1, dueDate: 1 });
platformInvoiceSchema.index({ openCheckoutKey: 1 }, { unique: true, sparse: true });
// A renewal for the same period can only be created ONCE (safe if the billing job runs twice)
platformInvoiceSchema.index(
  { subscriptionId: 1, kind: 1, periodStart: 1 },
  { unique: true, partialFilterExpression: { kind: 'RENEWAL' } }
);

const PlatformInvoice = mongoose.models.PlatformInvoice || mongoose.model('PlatformInvoice', platformInvoiceSchema);
export default PlatformInvoice;
