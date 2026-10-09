// A customer (company or person) — usually a converted lead. Quotes, invoices and projects belong to clients.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import softDeletePlugin from './plugins/softDelete.js';
import { CLIENT_TYPES, CLIENT_STATUSES } from '../config/erpOptions.js';

const str = (max) => ({ type: String, trim: true, maxlength: max, default: null });
const contactSchema = new mongoose.Schema({ name: str(120), role: str(80), email: str(254), phone: str(30) }, { _id: true });

const clientSchema = new mongoose.Schema(
  {
    type: { type: String, enum: CLIENT_TYPES, default: 'COMPANY' },
    name: { type: String, trim: true, maxlength: 150, required: true },
    email: str(254),
    phone: str(30),
    website: str(2048),
    address: str(300),
    city: str(60),
    country: str(60),
    taxId: str(60), // NTN / VAT number — printed on quotes & invoices
    notes: { type: String, trim: true, maxlength: 2000, default: '' },
    contacts: { type: [contactSchema], default: [] },
    status: { type: String, enum: CLIENT_STATUSES, default: 'ACTIVE' },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null }, // the lead it came from
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // responsible salesperson
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw' }
);

clientSchema.plugin(tenantScopePlugin);
clientSchema.plugin(softDeletePlugin);
clientSchema.index({ tenantId: 1, name: 1 });
clientSchema.index({ tenantId: 1, ownerId: 1 });
clientSchema.index({ tenantId: 1, leadId: 1 }, { unique: true, partialFilterExpression: { leadId: { $type: 'objectId' }, deletedAt: null } });

const Client = mongoose.models.Client || mongoose.model('Client', clientSchema);
export default Client;
