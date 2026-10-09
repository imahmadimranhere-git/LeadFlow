// A business expense (cash basis). Never deleted — a wrong one is VOIDED with a reason.
// Expenses dated inside a closed period (Settings → Accounting → "books closed until") can't be added or changed.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import { CURRENCIES, EXPENSE_STATUSES, PAYMENT_METHODS } from '../config/erpOptions.js';

const expenseSchema = new mongoose.Schema(
  {
    day: { type: String, match: /^\d{4}-\d{2}-\d{2}$/, required: true }, // when it was paid
    amountMinor: { type: Number, min: 1, required: true, validate: Number.isInteger },
    currency: { type: String, enum: CURRENCIES, required: true },
    category: { type: String, trim: true, maxlength: 40, required: true },
    vendor: { type: String, trim: true, maxlength: 120, default: '' },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    method: { type: String, enum: PAYMENT_METHODS, default: 'BANK_TRANSFER' },
    reference: { type: String, trim: true, maxlength: 120, default: '' }, // receipt / bill no.
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
    status: { type: String, enum: EXPENSE_STATUSES, default: 'RECORDED' },
    voidedAt: { type: Date, default: null },
    voidReason: { type: String, trim: true, maxlength: 300, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw' }
);

expenseSchema.plugin(tenantScopePlugin);
expenseSchema.index({ tenantId: 1, status: 1, day: -1 });
expenseSchema.index({ tenantId: 1, category: 1, day: -1 });
expenseSchema.index({ tenantId: 1, projectId: 1, day: -1 });

const Expense = mongoose.models.Expense || mongoose.model('Expense', expenseSchema);
export default Expense;
