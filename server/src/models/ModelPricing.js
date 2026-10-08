// Platform-wide AI model list + prices (USD per 1M tokens). Edited by the super admin — never hard-coded.
import mongoose from '../config/mongoose.js';
import { AI_PROVIDERS, MODEL_ID_PATTERN } from '../config/aiOptions.js';

const modelPricingSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: AI_PROVIDERS, required: true },
    modelId: { type: String, required: true, match: MODEL_ID_PATTERN },
    displayName: { type: String, trim: true, maxlength: 80, required: true },
    inputPerMTok: { type: Number, min: 0, max: 1000, required: true },
    outputPerMTok: { type: Number, min: 0, max: 1000, required: true },
    isActive: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false }, // the default model of its provider
    verified: { type: Boolean, default: false }, // model ID confirmed against the provider's model list
    notes: { type: String, trim: true, maxlength: 300, default: '' },
  },
  { timestamps: true, strict: 'throw' }
);

modelPricingSchema.index({ provider: 1, modelId: 1 }, { unique: true });
// at most ONE default per provider (enforced by the database)
modelPricingSchema.index({ provider: 1 }, { unique: true, partialFilterExpression: { isDefault: true } });

const ModelPricing = mongoose.models.ModelPricing || mongoose.model('ModelPricing', modelPricingSchema);
export default ModelPricing;
