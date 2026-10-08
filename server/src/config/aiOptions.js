// AI options. Model PRICES are data (ModelPricing collection, editable by the super admin) — the list
// below is only the first seed. Prices change: always check the official pages before relying on them.
//   Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
//   OpenAI:    https://openai.com/api/pricing/
export const AI_PROVIDERS = ['OPENAI', 'ANTHROPIC'];
export const AI_REQUEST_TYPES = ['LEAD_SCORING', 'MESSAGE_GENERATION', 'REPLY_GENERATION', 'WEBSITE_AUDIT', 'CLASSIFICATION', 'OTHER'];
export const AI_USAGE_STATUSES = ['SUCCESS', 'FAILED', 'INVALID_OUTPUT'];
export const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,80}$/;

export const AI_LIMITS = Object.freeze({
  maxInputChars: 24_000, // ~6k tokens of lead/evidence text per request
  minOutputTokens: 200,
  maxOutputTokens: 4000,
  defaultOutputTokens: 1000,
  timeoutMs: 45_000,
  maxRetries: 2,
});

// Seed prices: USD per 1 million tokens (checked October 2026 on the official pricing pages).
// `verified: false` = the API model ID must be confirmed by the super admin before use.
export const DEFAULT_MODEL_PRICING = [
  { provider: 'ANTHROPIC', modelId: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5', inputPerMTok: 2, outputPerMTok: 10, isDefault: true, verified: true },
  { provider: 'ANTHROPIC', modelId: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5', inputPerMTok: 1, outputPerMTok: 5, isDefault: false, verified: true },
  { provider: 'ANTHROPIC', modelId: 'claude-opus-5-5', displayName: 'Claude Opus 5.5', inputPerMTok: 4, outputPerMTok: 20, isDefault: false, verified: true },
  { provider: 'OPENAI', modelId: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna (check model ID)', inputPerMTok: 0.2, outputPerMTok: 1.2, isDefault: true, verified: false },
  { provider: 'OPENAI', modelId: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra (check model ID)', inputPerMTok: 2, outputPerMTok: 12, isDefault: false, verified: false },
];
