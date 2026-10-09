// A quotation / proposal. Totals are ALWAYS calculated on the server (services/erp/quoteMath.js);
// whatever totals a browser sends are ignored. Accepted quotes are a record and can't be edited.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import { CURRENCIES, QUOTE_STATUSES, DISCOUNT_TYPES } from '../config/erpOptions.js';

const int = (extra = {}) => ({ type: Number, required: true, validate: Number.isInteger, ...extra });

const lineSchema = new mongoose.Schema(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', default: null },
    description: { type: String, trim: true, maxlength: 500, required: true },
    unit: { type: String, trim: true, maxlength: 30, default: '' },
    qtyMilli: int({ min: 1 }),
    unitPriceMinor: int({ min: 0 }),
    catalogPriceMinor: { type: Number, default: null }, // price in the catalog when the line was added (for the discount rule)
    discountBp: int({ min: 0, max: 10000, default: 0 }),
    taxBp: int({ min: 0, max: 10000, default: 0 }),
    // ---- calculated by the server
    subtotalMinor: int(),
    discountMinor: int(),
    netMinor: int(),
    orderDiscountMinor: int(),
    taxMinor: int(),
    totalMinor: int(),
  },
  { _id: true }
);

const quoteSchema = new mongoose.Schema(
  {
    number: { type: String, maxlength: 30, required: true }, // Q-2026-0001
    title: { type: String, trim: true, maxlength: 150, default: '' },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    status: { type: String, enum: QUOTE_STATUSES, default: 'DRAFT' },
    currency: { type: String, enum: CURRENCIES, required: true },
    issueDate: { type: Date, default: Date.now },
    validUntil: { type: Date, default: null },
    lines: { type: [lineSchema], default: [] },
    discount: {
      type: { type: String, enum: DISCOUNT_TYPES, default: 'NONE' },
      valueBp: { type: Number, default: 0 },
      valueMinor: { type: Number, default: 0 },
    },
    // ---- calculated by the server
    subtotalMinor: int({ default: 0 }),
    lineDiscountMinor: int({ default: 0 }),
    orderDiscountMinor: int({ default: 0 }),
    discountMinor: int({ default: 0 }),
    taxMinor: int({ default: 0 }),
    totalMinor: int({ default: 0 }),
    effectiveDiscountBp: { type: Number, default: 0 },
    // ----
    notes: { type: String, trim: true, maxlength: 3000, default: '' }, // shown to the client
    terms: { type: String, trim: true, maxlength: 3000, default: '' },
    internalNote: { type: String, trim: true, maxlength: 1000, default: '' }, // NOT printed
    revision: { type: Number, default: 1 },
    sentAt: { type: Date, default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, trim: true, maxlength: 300, default: null },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw', optimisticConcurrency: true }
);

quoteSchema.plugin(tenantScopePlugin);
quoteSchema.index({ tenantId: 1, number: 1 }, { unique: true });
quoteSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
quoteSchema.index({ tenantId: 1, clientId: 1, createdAt: -1 });
quoteSchema.index({ tenantId: 1, leadId: 1, createdAt: -1 });
quoteSchema.index({ tenantId: 1, ownerId: 1, createdAt: -1 });

const Quote = mongoose.models.Quote || mongoose.model('Quote', quoteSchema);
export default Quote;
