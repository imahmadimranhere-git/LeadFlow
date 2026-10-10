// One settings document per tenant: profile, services, ideal customer profile, discovery terms,
// brand voice, branding, pipeline stages, scoring weights and starter templates.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import { templateSchema, scoringWeightsSchema } from './IndustryPack.js';
import { DEFAULT_TIMEZONE, DEFAULT_DIGEST_HOUR } from '../config/notificationOptions.js';
import { CURRENCIES } from './Plan.js';
import { DEFAULT_EXPENSE_CATEGORIES } from '../config/erpOptions.js';
import {
  LEAD_SOURCES, BRAND_TONES, COMPANY_SIZES, DEFAULT_SCORING_WEIGHTS, DEFAULT_PIPELINE_STAGES,
} from '../config/settingsOptions.js';

const str = (max) => ({ type: String, trim: true, maxlength: max, default: null });

const tenantSettingsSchema = new mongoose.Schema(
  {
    onboarding: {
      completedAt: { type: Date, default: null },
      skipped: { type: Boolean, default: false },
    },
    industryPack: {
      packId: { type: mongoose.Schema.Types.ObjectId, ref: 'IndustryPack', default: null },
      code: { type: String, default: null, maxlength: 40 },
      name: { type: String, default: null, maxlength: 80 },
      appliedAt: { type: Date, default: null },
    },
    profile: {
      description: str(1000),
      email: str(254),
      phone: str(30),
      website: str(2048),
      address: str(200),
      country: str(60),
      city: str(60),
      socialLinks: {
        linkedin: str(2048),
        facebook: str(2048),
        instagram: str(2048),
        x: str(2048),
        youtube: str(2048),
      },
    },
    services: {
      type: [
        new mongoose.Schema(
          { name: { type: String, required: true, maxlength: 80 }, description: { type: String, maxlength: 300, default: '' } },
          { _id: false }
        ),
      ],
      default: [],
    },
    icp: {
      countries: { type: [String], default: [] },
      cities: { type: [String], default: [] },
      industries: { type: [String], default: [] },
      businessTypes: { type: [String], default: [] },
      companySizes: { type: [{ type: String, enum: COMPANY_SIZES }], default: [] },
      targetRoles: { type: [String], default: [] },
    },
    discovery: {
      keywords: { type: [String], default: [] },
      hashtags: { type: [String], default: [] },
      intentPhrases: { type: [String], default: [] },
      negativeKeywords: { type: [String], default: [] },
      preferredSources: { type: [{ type: String, enum: LEAD_SOURCES }], default: [] },
    },
    brandVoice: {
      tone: { type: String, enum: BRAND_TONES, default: 'PROFESSIONAL' },
      customInstructions: { type: String, trim: true, maxlength: 1000, default: '' },
    },
    branding: {
      accentColor: { type: String, match: /^#[0-9a-f]{6}$/i, default: null },
      logoAssetId: { type: mongoose.Schema.Types.ObjectId, ref: 'TenantAsset', default: null },
      logoVersion: { type: String, default: null, maxlength: 20 },
    },
    pipelineStages: { type: [String], default: () => [...DEFAULT_PIPELINE_STAGES] },
    scoringWeights: { type: scoringWeightsSchema, default: () => ({ ...DEFAULT_SCORING_WEIGHTS }) },
    ai: {
      provider: { type: String, enum: ['AUTO', 'OPENAI', 'ANTHROPIC'], default: 'AUTO' }, // AUTO = your own key first
      model: { type: String, maxlength: 82, default: null }, // null = platform default of that provider
      temperature: { type: Number, min: 0, max: 1, default: null }, // null = provider default
      maxOutputTokens: { type: Number, min: 200, max: 4000, default: 1000 },
      maxRetries: { type: Number, min: 0, max: 2, default: 1 },
      // Phase 26: monthly AI budget (estimated USD, company calendar month). null = no budget.
      monthlyBudgetUsd: { type: Number, min: 0, max: 100000, default: null },
      budgetAlertPercent: { type: Number, min: 50, max: 100, default: 80 }, // warn owners/admins at this %
      budgetHardStop: { type: Boolean, default: false }, // true = new AI requests refused once the budget is used up
    },
    general: {
      timezone: { type: String, maxlength: 64, default: DEFAULT_TIMEZONE }, // "today" for follow-ups + digest time
      digestHour: { type: Number, min: 0, max: 23, default: DEFAULT_DIGEST_HOUR }, // daily follow-up email, local hour
    },
    sales: {
      currency: { type: String, enum: CURRENCIES, default: 'USD' }, // prices + new quotes
      defaultTaxBp: { type: Number, min: 0, max: 10000, default: 0 }, // e.g. 1700 = 17 %
      salesMaxDiscountBp: { type: Number, min: 0, max: 10000, default: 1000 }, // Sales role: max discount without a manager
      quoteValidityDays: { type: Number, min: 1, max: 365, default: 15 },
      quotePrefix: { type: String, maxlength: 6, default: 'Q', match: /^[A-Z]{1,6}$/ },
      quoteTerms: { type: String, trim: true, maxlength: 3000, default: '' },
      taxId: { type: String, trim: true, maxlength: 60, default: '' }, // NTN / VAT no. printed on quotes
      invoicePrefix: { type: String, maxlength: 6, default: 'INV', match: /^[A-Z]{1,6}$/ },
      paymentTermsDays: { type: Number, min: 0, max: 365, default: 15 }, // due date = issue date + this
      invoiceFooter: { type: String, trim: true, maxlength: 2000, default: '' }, // e.g. bank account details
    },
    accounting: {
      expenseCategories: { type: [{ type: String, trim: true, maxlength: 40 }], default: () => [...DEFAULT_EXPENSE_CATEGORIES] },
      lockedUntil: { type: String, default: null, match: /^\d{4}-\d{2}-\d{2}$/ }, // books closed up to this day (no changes on or before)
    },
    outreach: {
      dailyEmailLimit: { type: Number, min: 1, max: 1000, default: 100 }, // protects your mailbox reputation
      emailSignature: { type: String, trim: true, maxlength: 500, default: '' },
      postalAddress: { type: String, trim: true, maxlength: 200, default: '' }, // shown in email footers (many laws require it)
    },
    messageTemplates: { type: [templateSchema], default: [] }, // starter templates; Phase 15 moves them into the Templates module
  },
  { timestamps: true, strict: 'throw' }
);

tenantSettingsSchema.plugin(tenantScopePlugin);
tenantSettingsSchema.index({ tenantId: 1 }, { unique: true });

const TenantSettings = mongoose.models.TenantSettings || mongoose.model('TenantSettings', tenantSettingsSchema);
export default TenantSettings;
