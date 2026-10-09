// Catalog item: a product, a service, a property (plot / apartment) or anything else a company sells.
// Industry-agnostic: extra details go into customFields (e.g. "Size: 10 marla", "Block: C").
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import softDeletePlugin from './plugins/softDelete.js';
import { CURRENCIES, ITEM_TYPES, ITEM_STATUSES, ITEM_AVAILABILITY } from '../config/erpOptions.js';

const itemSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 150, required: true },
    nameKey: { type: String, maxlength: 150, required: true, private: true }, // lowercase → unique per company
    type: { type: String, enum: ITEM_TYPES, default: 'SERVICE' },
    sku: { type: String, trim: true, maxlength: 60, default: null },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    unit: { type: String, trim: true, maxlength: 30, default: '' }, // hour, piece, marla, month…
    currency: { type: String, enum: CURRENCIES, required: true },
    priceMinor: { type: Number, min: 0, required: true, validate: Number.isInteger },
    taxBp: { type: Number, min: 0, max: 10000, default: 0, validate: Number.isInteger },
    status: { type: String, enum: ITEM_STATUSES, default: 'ACTIVE' },
    availability: { type: String, enum: ITEM_AVAILABILITY, default: 'NOT_TRACKED' },
    stockQty: { type: Number, min: 0, default: null }, // null = not counted
    customFields: { type: Map, of: { type: String, maxlength: 500 }, default: {} },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw' }
);

itemSchema.plugin(tenantScopePlugin);
itemSchema.plugin(softDeletePlugin);
itemSchema.index({ tenantId: 1, nameKey: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
itemSchema.index({ tenantId: 1, sku: 1 }, { unique: true, partialFilterExpression: { sku: { $type: 'string' }, deletedAt: null } });
itemSchema.index({ tenantId: 1, status: 1, type: 1, name: 1 });

const Item = mongoose.models.Item || mongoose.model('Item', itemSchema);
export default Item;
