// Option lists shared by Industry Packs and Tenant Settings (data, not business logic).
export { CONNECTORS as LEAD_SOURCES } from '../models/Plan.js';

export const BRAND_TONES = ['PROFESSIONAL', 'FRIENDLY', 'TECHNICAL', 'CONCISE', 'CUSTOM'];
export const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-1000', '1000+'];
export const TEMPLATE_CHANNELS = ['EMAIL', 'LINKEDIN', 'INSTAGRAM_DM', 'FACEBOOK_MESSAGE', 'WHATSAPP', 'GENERAL'];

// Lead scoring factors (Phase 14 uses these). Weights 0–100, editable per tenant.
export const SCORING_FACTORS = [
  'explicitBuyerIntent',
  'websiteCondition',
  'businessRelevance',
  'serviceMatch',
  'industryMatch',
  'locationMatch',
  'contactability',
  'publicActivity',
  'evidenceStrength',
  'profileCompleteness',
];

export const DEFAULT_SCORING_WEIGHTS = Object.freeze({
  explicitBuyerIntent: 30,
  websiteCondition: 10,
  businessRelevance: 10,
  serviceMatch: 15,
  industryMatch: 5,
  locationMatch: 10,
  contactability: 5,
  publicActivity: 5,
  evidenceStrength: 5,
  profileCompleteness: 5,
});

export const DEFAULT_PIPELINE_STAGES = ['New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];

// Upper bounds for list sizes (protects the DB and later AI prompts from huge inputs)
export const LIST_LIMITS = Object.freeze({
  services: 50,
  keywords: 100,
  hashtags: 100,
  intentPhrases: 100,
  negativeKeywords: 100,
  icpItems: 50,
  pipelineStages: 15,
  templates: 50,
});
