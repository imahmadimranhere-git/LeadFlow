// A payment received from a client against one invoice. Never edited or deleted — a wrong entry is VOIDED
// (with a reason), which gives the amount back to the invoice balance. Full history stays.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import { CURRENCIES, PAYMENT_METHODS } from '../config/erpOptions.js';

const paymentSchema = new mongoose.Schema(
  {
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientInvoice', required: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
    amountMinor: { type: Number, required: true, min: 1, validate: Number.isInteger },
    currency: { type: String, enum: CURRENCIES, required: true },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    reference: { type: String, trim: true, maxlength: 120, default: '' }, // cheque no., bank ref…
    paidAt: { type: Date, required: true },
    note: { type: String, trim: true, maxlength: 300, default: '' },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    voided: { type: Boolean, default: false },
    voidedAt: { type: Date, default: null },
    voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    voidReason: { type: String, trim: true, maxlength: 300, default: null },
  },
  { timestamps: true, strict: 'throw' }
);

paymentSchema.plugin(tenantScopePlugin);
paymentSchema.index({ tenantId: 1, invoiceId: 1, paidAt: 1 });
paymentSchema.index({ tenantId: 1, clientId: 1, paidAt: -1 });
paymentSchema.index({ tenantId: 1, paidAt: -1 });

const ClientPayment = mongoose.models.ClientPayment || mongoose.model('ClientPayment', paymentSchema, 'clientPayments');
export default ClientPayment;
