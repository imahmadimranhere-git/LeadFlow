// Industry Pack = a preset a tenant can pick during onboarding (platform-level, edited by super admin).
// When a tenant applies a pack, its contents are COPIED into the tenant's own settings,
// so later edits to the pack never change a tenant's data silently.
import mongoose from '../config/mongoose.js';
import { LEAD_SOURCES, TEMPLATE_CHANNELS, SCORING_FACTORS } from '../config/settingsOptions.js';

const serviceSchema = new mongoose.Schema(
  { name: { type: String, required: true, maxlength: 80 }, description: { type: String, maxlength: 300, default: '' } },
  { _id: false }
);

export const templateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, maxlength: 80 },
    channel: { type: String, enum: TEMPLATE_CHANNELS, required: true },
    subject: { type: String, maxlength: 150, default: '' },
    body: { type: String, required: true, maxlength: 2000 },
  },
  { _id: false }
);

export const scoringWeightsSchema = new mongoose.Schema(
  Object.fromEntries(SCORING_FACTORS.map((f) => [f, { type: Number, min: 0, max: 100, default: 0 }])),
  { _id: false }
);

const industryPackSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, lowercase: true, trim: true, maxlength: 40, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    icon: { type: String, maxlength: 30, default: 'sparkles' },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, min: 0, max: 1000, default: 0 },
    services: { type: [serviceSchema], default: [] },
    keywords: { type: [String], default: [] },
    hashtags: { type: [String], default: [] },
    intentPhrases: { type: [String], default: [] },
    negativeKeywords: { type: [String], default: [] },
    sources: { type: [{ type: String, enum: LEAD_SOURCES }], default: [] },
    icp: {
      industries: { type: [String], default: [] },
      businessTypes: { type: [String], default: [] },
      targetRoles: { type: [String], default: [] },
    },
    pipelineStages: { type: [String], default: [] },
    scoringWeights: { type: scoringWeightsSchema, default: () => ({}) },
    messageTemplates: { type: [templateSchema], default: [] },
  },
  { timestamps: true, strict: 'throw' }
);

industryPackSchema.index({ code: 1 }, { unique: true });

const IndustryPack = mongoose.models.IndustryPack || mongoose.model('IndustryPack', industryPackSchema);
export default IndustryPack;
