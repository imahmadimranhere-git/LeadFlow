// Subscription plans — 100% data, editable by the super admin (nothing hard-coded).
// Limits: -1 means "unlimited".
import mongoose from '../config/mongoose.js';

export const CURRENCIES = ['USD', 'PKR', 'EUR', 'GBP', 'AED', 'SAR'];
export const CONNECTORS = [
  'CSV', 'GOOGLE_WEB', 'LOCAL_BUSINESS', 'INSTAGRAM', 'FACEBOOK',
  'LINKEDIN', 'CHROME_EXTENSION', 'DATA_PROVIDER', 'WEBHOOK',
];
export const ERP_MODULES = ['SALES', 'INVOICING', 'PROJECTS', 'ITEMS', 'ACCOUNTING', 'HR', 'SUPPORT', 'CUSTOM_FIELDS'];
export const LIMIT_KEYS = [
  'users', 'leadsPerMonth', 'discoverySearchesPerMonth', 'aiRequestsPerMonth',
  'aiTokensPerMonth', 'hashtagWatches', 'storageMb', 'exportsPerMonth',
];

const limit = { type: Number, required: true, min: -1, max: 1_000_000_000 };

const planSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, lowercase: true, maxlength: 40, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    currency: { type: String, enum: CURRENCIES, default: 'USD' },
    // Money is stored in the smallest unit (cents/paisa) as an integer → no floating point errors
    priceMonthlyMinor: { type: Number, required: true, min: 0, max: 100_000_000 },
    priceYearlyMinor: { type: Number, required: true, min: 0, max: 1_000_000_000 },
    trialDays: { type: Number, default: 0, min: 0, max: 90 },
    limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, limit])),
    connectors: { type: [{ type: String, enum: CONNECTORS }], default: [] },
    erpModules: { type: [{ type: String, enum: ERP_MODULES }], default: [] },
    features: { type: [{ type: String, maxlength: 40 }], default: [] },
    isActive: { type: Boolean, default: true },
    isPublic: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0, min: 0, max: 1000 },
  },
  { timestamps: true, strict: 'throw' }
);

planSchema.index({ code: 1 }, { unique: true });

const Plan = mongoose.models.Plan || mongoose.model('Plan', planSchema);
export default Plan;
