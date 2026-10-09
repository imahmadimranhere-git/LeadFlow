// A client invoice. Number is given only when ISSUED (so cancelled drafts never leave gaps), and an issued
// invoice can't be edited — mistakes are fixed by voiding it (with a reason) and issuing a new one.
// paidMinor / balanceMinor change ONLY through payments, atomically (no overpayment even with two clicks).
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import { CURRENCIES, INVOICE_STATUSES, DISCOUNT_TYPES } from '../config/erpOptions.js';

const int = (extra = {}) => ({ type: Number, required: true, validate: Number.isInteger, ...extra });
const lineSchema = new mongoose.Schema(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', default: null },
    description: { type: String, trim: true, maxlength: 500, required: true },
    unit: { type: String, trim: true, maxlength: 30, default: '' },
    qtyMilli: int({ min: 1 }),
    unitPriceMinor: int({ min: 0 }),
    catalogPriceMinor: { type: Number, default: null },
    discountBp: int({ min: 0, max: 10000, default: 0 }),
    taxBp: int({ min: 0, max: 10000, default: 0 }),
    subtotalMinor: int(),
    discountMinor: int(),
    netMinor: int(),
    orderDiscountMinor: int(),
    taxMinor: int(),
    totalMinor: int(),
  },
  { _id: true }
);

const invoiceSchema = new mongoose.Schema(
  {
    number: { type: String, maxlength: 30, default: null }, // INV-2026-0001 (set when issued)
    title: { type: String, trim: true, maxlength: 150, default: '' },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
    quoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quote', default: null },
    quoteLink: { type: mongoose.Schema.Types.ObjectId, default: null, private: true }, // = quoteId while not void → one live invoice per quote
    status: { type: String, enum: INVOICE_STATUSES, default: 'DRAFT' },
    currency: { type: String, enum: CURRENCIES, required: true },
    issueDate: { type: Date, default: null },
    dueDate: { type: Date, default: null },
    lines: { type: [lineSchema], default: [] },
    discount: { type: { type: String, enum: DISCOUNT_TYPES, default: 'NONE' }, valueBp: { type: Number, default: 0 }, valueMinor: { type: Number, default: 0 } },
    subtotalMinor: int({ default: 0 }),
    lineDiscountMinor: int({ default: 0 }),
    orderDiscountMinor: int({ default: 0 }),
    discountMinor: int({ default: 0 }),
    taxMinor: int({ default: 0 }),
    totalMinor: int({ default: 0 }),
    effectiveDiscountBp: { type: Number, default: 0 },
    paidMinor: int({ default: 0, min: 0 }),
    balanceMinor: int({ default: 0, min: 0 }),
    paidAt: { type: Date, default: null },
    notes: { type: String, trim: true, maxlength: 3000, default: '' },
    footer: { type: String, trim: true, maxlength: 2000, default: '' }, // bank details etc. (copied from settings)
    internalNote: { type: String, trim: true, maxlength: 1000, default: '' },
    stockTaken: { type: Boolean, default: false, private: true },
    voidedAt: { type: Date, default: null },
    voidReason: { type: String, trim: true, maxlength: 300, default: null },
    overdueNotifiedAt: { type: Date, default: null, private: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw', optimisticConcurrency: true }
);

invoiceSchema.plugin(tenantScopePlugin);
invoiceSchema.index({ tenantId: 1, number: 1 }, { unique: true, partialFilterExpression: { number: { $type: 'string' } } });
invoiceSchema.index({ tenantId: 1, quoteLink: 1 }, { unique: true, partialFilterExpression: { quoteLink: { $type: 'objectId' } } });
invoiceSchema.index({ tenantId: 1, status: 1, dueDate: 1 });
invoiceSchema.index({ tenantId: 1, clientId: 1, createdAt: -1 });
invoiceSchema.index({ status: 1, dueDate: 1, overdueNotifiedAt: 1 });

const ClientInvoice = mongoose.models.ClientInvoice || mongoose.model('ClientInvoice', invoiceSchema, 'clientInvoices');
export default ClientInvoice;
