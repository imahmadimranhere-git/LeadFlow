// One subscription per tenant: which plan, which billing cycle, and where it is in its lifecycle.
// Tenant-scoped (a tenant can only ever read its own subscription).
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';

export const SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'];
export const BILLING_CYCLES = ['MONTHLY', 'YEARLY'];
export const PAYMENT_PROVIDERS = ['MANUAL', 'SAFEPAY', 'PAYFAST', 'PADDLE', 'LEMON_SQUEEZY', 'STRIPE', 'OTHER'];

const subscriptionSchema = new mongoose.Schema(
  {
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
    status: { type: String, enum: SUBSCRIPTION_STATUSES, required: true },
    billingCycle: { type: String, enum: BILLING_CYCLES, default: 'MONTHLY' },
    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null, index: true },
    trialEndsAt: { type: Date, default: null, index: true },
    graceEndsAt: { type: Date, default: null, index: true },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, trim: true, maxlength: 300, default: null },
    provider: { type: String, enum: PAYMENT_PROVIDERS, default: 'MANUAL' },
    providerCustomerId: { type: String, default: null, maxlength: 200, private: true },
    providerSubscriptionId: { type: String, default: null, maxlength: 200, private: true },
    lastPaymentAt: { type: Date, default: null },
    overrideNote: { type: String, trim: true, maxlength: 500, default: null },
  },
  { timestamps: true, strict: 'throw' }
);

subscriptionSchema.plugin(tenantScopePlugin);
subscriptionSchema.index({ tenantId: 1 }, { unique: true });
subscriptionSchema.index({ status: 1 });

const Subscription = mongoose.models.Subscription || mongoose.model('Subscription', subscriptionSchema);
export default Subscription;
