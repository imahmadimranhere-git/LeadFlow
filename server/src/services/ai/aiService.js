// The ONE place where the app talks to an AI model.
//
//   runAi(auth, { requestType, system, user, schemaName, jsonSchema, outputSchema (zod), target })
//
// 1. Which key?   your own key (vault) first → platform key only if your plan has "platform-ai"
// 2. Which model? your AI settings → else the platform default of that provider (super admin's price list)
// 2b. Budget      monthly AI budget (Phase 26): refused (402) if the owner chose a hard stop and it is used up
// 3. Quota        1 AI request + a token RESERVATION (estimated input + max output) taken BEFORE the call,
//                 corrected to the real numbers afterwards → parallel requests can't overshoot the plan
// 4. Call         timeout, limited retries (rate limit / provider down / unreadable answer) with backoff
// 5. Validate     the answer must match a strict zod schema — AI output is untrusted input
// 6. Log          AiUsageLog: tokens, cost, status — never the prompt, the lead text or the key
// 7. Alert        budget WARN / EXCEEDED notification (once per level per month)
import env from '../../config/env.js';
import TenantSettings from '../../models/TenantSettings.js';
import TenantIntegration from '../../models/TenantIntegration.js';
import AiUsageLog from '../../models/AiUsageLog.js';
import ApiError from '../../utils/ApiError.js';
import logger from '../../config/logger.js';
import { AI_LIMITS } from '../../config/aiOptions.js';
import { getCredentials } from '../integrations/vaultService.js';
import { getEffectivePlan } from '../billing/planResolver.js';
import { consumeQuota, releaseQuota, addUsage } from '../billing/quotaService.js';
import { complete, AiError } from './providers.js';
import { estimateTokens, costUsd } from './promptSafety.js';
import { findActiveModel, defaultModel } from './modelPricingService.js';
import { checkBudgetBefore, afterAiUsage } from './aiBudget.js';

const RETRY_BASE_MS = env.NODE_ENV === 'test' ? 0 : 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FRIENDLY = {
  KEY_INVALID: 'Your AI key was rejected by the provider. Check it in Settings → Integrations.',
  MODEL_NOT_FOUND: 'The selected AI model is not available for this key. Choose another model in Settings → Company → AI.',
  RATE_LIMITED: 'The AI provider is busy right now. Please try again in a minute.',
  PROVIDER_DOWN: 'The AI provider is having problems. Please try again later.',
  TIMEOUT: 'The AI took too long to answer. Please try again.',
  NETWORK: 'Could not reach the AI provider. Please try again.',
  REFUSED: 'The AI declined to answer this request.',
  INVALID_OUTPUT: 'The AI answer was not usable (it did not follow the required format). Nothing was saved — please try again.',
  BAD_REQUEST: 'The AI provider refused the request.',
};

export async function getAiSettings() {
  const s = await TenantSettings.findOne({}).select('ai');
  const ai = s?.ai?.toObject ? s.ai.toObject() : s?.ai || {};
  return {
    provider: ai.provider || 'AUTO',
    model: ai.model || null,
    temperature: ai.temperature ?? null,
    maxOutputTokens: ai.maxOutputTokens || AI_LIMITS.defaultOutputTokens,
    maxRetries: Math.min(AI_LIMITS.maxRetries, ai.maxRetries ?? 1),
  };
}

/** Your own key first; the platform key only when the plan includes "platform-ai". */
export async function resolveCredentials(tenantId, preferred = 'AUTO', purpose = 'ai') {
  const providers = preferred === 'AUTO' ? ['OPENAI', 'ANTHROPIC'] : [preferred];
  for (const provider of providers) {
    const creds = await getCredentials(provider, { purpose });
    if (creds?.secrets?.apiKey) return { provider, source: 'TENANT', apiKey: creds.secrets.apiKey, organizationId: creds.config?.organizationId || null };
  }
  const plan = await getEffectivePlan(tenantId);
  if ((plan.features || []).includes('platform-ai')) {
    for (const provider of providers) {
      const key = provider === 'OPENAI' ? env.PLATFORM_OPENAI_API_KEY : env.PLATFORM_ANTHROPIC_API_KEY;
      if (key) return { provider, source: 'PLATFORM', apiKey: key, organizationId: null };
    }
  }
  return null;
}

async function resolveModel(provider, wanted) {
  const model = (wanted && (await findActiveModel(provider, wanted))) || (await defaultModel(provider));
  if (!model) throw ApiError.badRequest(`No ${provider === 'OPENAI' ? 'OpenAI' : 'Anthropic'} model is set up on this platform yet (super admin → AI models).`, [{ code: 'AI_NO_MODEL', field: 'ai.model', message: provider }]);
  return model;
}

function zodMessage(error) {
  const i = error.issues?.[0];
  return i ? `${i.path.join('.') || 'answer'}: ${i.message}`.slice(0, 120) : 'invalid';
}

export async function runAi(auth, { requestType, system, user, schemaName, jsonSchema, outputSchema, target = null }) {
  const settings = await getAiSettings();
  const cred = await resolveCredentials(auth.tenantId, settings.provider, `ai:${requestType.toLowerCase()}`);
  if (!cred) {
    throw ApiError.badRequest('No AI key is connected. Add an OpenAI or Anthropic key in Settings → Integrations.', [{ code: 'AI_NOT_CONFIGURED', field: '', message: 'no key' }]);
  }
  const pricing = await resolveModel(cred.provider, settings.model);
  const maxOutputTokens = Math.min(AI_LIMITS.maxOutputTokens, Math.max(AI_LIMITS.minOutputTokens, settings.maxOutputTokens));

  // ---- monthly budget (Phase 26) — checked before any quota or money is spent
  const budgetCtx = await checkBudgetBefore();

  // ---- quota: reserve first (atomic), settle afterwards
  const reserved = estimateTokens(system) + estimateTokens(user) + maxOutputTokens;
  await consumeQuota(auth.tenantId, 'aiRequests', 1);
  try {
    await consumeQuota(auth.tenantId, 'aiTokens', reserved);
  } catch (err) {
    await releaseQuota(auth.tenantId, 'aiRequests', 1);
    throw err;
  }

  const started = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let attempts = 0;
  let value = null;
  let lastError = null;

  for (let i = 0; i <= settings.maxRetries; i += 1) {
    attempts += 1;
    try {
      const r = await complete({ provider: cred.provider, apiKey: cred.apiKey, organizationId: cred.organizationId, model: pricing.modelId, system, user, schemaName, jsonSchema, maxOutputTokens, temperature: settings.temperature });
      inputTokens += r.inputTokens;
      outputTokens += r.outputTokens;
      const parsed = outputSchema.safeParse(r.output);
      if (parsed.success) {
        value = parsed.data;
        lastError = null;
        break;
      }
      lastError = new AiError('INVALID_OUTPUT', `AI answer failed validation (${zodMessage(parsed.error)})`, { retryable: true });
    } catch (err) {
      if (!(err instanceof AiError)) {
        logger.error({ err: err.message }, 'unexpected AI error');
        lastError = new AiError('NETWORK', 'Unexpected error', { retryable: false });
      } else {
        lastError = err;
        inputTokens += err.usage?.inputTokens || 0;
        outputTokens += err.usage?.outputTokens || 0;
      }
      if (!lastError.retryable) break;
    }
    if (i < settings.maxRetries) await sleep(RETRY_BASE_MS * 2 ** i);
  }

  // ---- settle quota with the real numbers
  const used = inputTokens + outputTokens;
  if (used < reserved) await releaseQuota(auth.tenantId, 'aiTokens', reserved - used);
  else if (used > reserved) await addUsage(auth.tenantId, 'aiTokens', used - reserved);
  if (lastError && used === 0) await releaseQuota(auth.tenantId, 'aiRequests', 1); // nothing was spent

  const status = !lastError ? 'SUCCESS' : lastError.code === 'INVALID_OUTPUT' ? 'INVALID_OUTPUT' : 'FAILED';
  const log = await AiUsageLog.create({
    userId: auth.userId,
    provider: cred.provider,
    model: pricing.modelId,
    requestType,
    keySource: cred.source,
    inputTokens,
    outputTokens,
    totalTokens: used,
    estimatedCostUsd: costUsd(pricing, inputTokens, outputTokens),
    status,
    errorCode: lastError?.code || null,
    attempts,
    durationMs: Date.now() - started,
    targetType: target?.type || null,
    targetId: target?.id || null,
  });
  try {
    await afterAiUsage(budgetCtx, log.estimatedCostUsd);
  } catch (err) {
    logger.warn({ err: err.message }, 'AI budget alert failed'); // an alert problem never fails the AI answer
  }

  if (lastError) {
    if (lastError.code === 'KEY_INVALID' && cred.source === 'TENANT') {
      await TenantIntegration.updateOne({ provider: cred.provider }, { $set: { status: 'ERROR', lastError: 'The key was rejected during an AI request' } });
    }
    if (lastError.code === 'KEY_INVALID' && cred.source === 'PLATFORM') logger.error({ provider: cred.provider }, 'PLATFORM AI key rejected');
    const err = new ApiError(lastError.status || 502, FRIENDLY[lastError.code] || FRIENDLY.BAD_REQUEST, [{ code: `AI_${lastError.code}`, field: '', message: lastError.code }]);
    err.usageLogId = log._id;
    throw err;
  }

  return {
    data: value,
    usage: { provider: cred.provider, model: pricing.modelId, keySource: cred.source, inputTokens, outputTokens, costUsd: log.estimatedCostUsd, attempts },
    usageLogId: log._id,
  };
}
