// A payment received for a platform invoice. providerPaymentId is unique → the same payment
// can never be recorded twice (double-click, webhook retry...).
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import { PAYMENT_PROVIDERS } from './Subscription.js';
import { CURRENCIES } from './Plan.js';

export const PAYMENT_METHODS = ['BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA', 'CARD', 'CASH', 'OTHER'];

const paymentSchema = new mongoose.Schema(
  {
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformInvoice', required: true, index: true },
    amountMinor: { type: Number, required: true, min: 0, validate: Number.isInteger },
    currency: { type: String, enum: CURRENCIES, required: true },
    provider: { type: String, enum: PAYMENT_PROVIDERS, required: true },
    providerPaymentId: { type: String, required: true, maxlength: 200 },
    method: { type: String, enum: PAYMENT_METHODS, default: 'OTHER' },
    reference: { type: String, maxlength: 200, default: null },
    status: { type: String, enum: ['SUCCEEDED', 'FAILED', 'REFUNDED'], default: 'SUCCEEDED' },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformAdmin', default: null },
    note: { type: String, maxlength: 300, default: null },
  },
  { timestamps: true, strict: 'throw' }
);

paymentSchema.plugin(tenantScopePlugin);
paymentSchema.index({ provider: 1, providerPaymentId: 1 }, { unique: true });
paymentSchema.index({ createdAt: -1 });

const Payment = mongoose.models.Payment || mongoose.model('Payment', paymentSchema);
export default Payment;
