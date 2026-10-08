// The two AI providers behind ONE small interface:
//   complete({ provider, apiKey, organizationId, model, system, user, schemaName, jsonSchema, maxOutputTokens, temperature })
//   → { output (parsed JSON object), inputTokens, outputTokens }
//
// - Fixed hosts only (api.openai.com / api.anthropic.com) through SafeFetch — no URL from users.
// - Structured output:
//     OpenAI    → response_format json_schema (strict)
//     Anthropic → one forced "submit_result" tool whose input_schema is our schema. The tool does NOTHING
//                 on our side — it is only the shape of the answer (the AI has no real tools/actions).
// - Provider error bodies are never shown to users or logged (they can echo our prompt back).
import { safeFetch, SafeFetchError } from '../../utils/safeFetch.js';
import { AI_LIMITS } from '../../config/aiOptions.js';

export class AiError extends Error {
  constructor(code, message, { retryable = false, status = 502 } = {}) {
    super(message);
    this.name = 'AiError';
    this.code = code; // KEY_INVALID | RATE_LIMITED | PROVIDER_DOWN | TIMEOUT | BAD_REQUEST | MODEL_NOT_FOUND | REFUSED | INVALID_OUTPUT | NETWORK
    this.retryable = retryable;
    this.status = status;
  }
}

let transport = async (url, { headers, body }) => {
  const res = await safeFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify(body),
    timeoutMs: AI_LIMITS.timeoutMs,
    maxBytes: 2 * 1024 * 1024,
    maxRedirects: 0,
  });
  return { status: res.status, json: () => res.json() };
};

/** Tests replace the network with a fake. */
export function setAiTransport(fn) {
  transport = fn;
}

function errorFromStatus(status, providerCode = '') {
  if (status === 401 || status === 403) return new AiError('KEY_INVALID', 'The AI provider rejected the API key', { status: 400 });
  if (status === 404 || /model/i.test(providerCode)) return new AiError('MODEL_NOT_FOUND', 'This AI model is not available for this key', { status: 400 });
  if (status === 429) return new AiError('RATE_LIMITED', 'The AI provider is busy (rate limit)', { retryable: true, status: 503 });
  if (status >= 500) return new AiError('PROVIDER_DOWN', 'The AI provider is having problems', { retryable: true, status: 503 });
  return new AiError('BAD_REQUEST', 'The AI provider refused the request', { status: 502 });
}

async function post(url, headers, body) {
  let res;
  try {
    res = await transport(url, { headers, body });
  } catch (err) {
    if (err instanceof SafeFetchError && err.code === 'TIMEOUT') throw new AiError('TIMEOUT', 'The AI provider did not answer in time', { retryable: true, status: 504 });
    throw new AiError('NETWORK', 'Could not reach the AI provider', { retryable: true, status: 503 });
  }
  let json = null;
  try {
    json = res.json();
  } catch {
    /* not JSON */
  }
  if (res.status < 200 || res.status >= 300) {
    const code = String(json?.error?.code || json?.error?.type || '');
    throw errorFromStatus(res.status, res.status === 400 && /model/i.test(code) ? code : '');
  }
  if (!json || typeof json !== 'object') throw new AiError('INVALID_OUTPUT', 'The AI answer could not be read', { retryable: true });
  return json;
}

// OpenAI's strict mode doesn't accept every JSON-schema keyword → send a copy without length/size limits
// (the server checks those itself with zod afterwards anyway).
const OPENAI_UNSUPPORTED = new Set(['maxLength', 'minLength', 'maxItems', 'minItems', 'pattern', 'format']);
export function toOpenAiSchema(node) {
  if (Array.isArray(node)) return node.map(toOpenAiSchema);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (OPENAI_UNSUPPORTED.has(k)) continue;
    out[k] = k === 'properties' ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toOpenAiSchema(pv)])) : toOpenAiSchema(v);
  }
  return out;
}

const toInt = (n) => (Number.isFinite(Number(n)) && Number(n) >= 0 ? Math.round(Number(n)) : 0);

async function openai(o) {
  const json = await post(
    'https://api.openai.com/v1/chat/completions',
    { authorization: `Bearer ${o.apiKey}`, ...(o.organizationId ? { 'openai-organization': o.organizationId } : {}) },
    {
      model: o.model,
      messages: [
        { role: 'system', content: o.system },
        { role: 'user', content: o.user },
      ],
      response_format: { type: 'json_schema', json_schema: { name: o.schemaName, strict: true, schema: toOpenAiSchema(o.jsonSchema) } },
      max_completion_tokens: o.maxOutputTokens,
      ...(o.temperature !== null && o.temperature !== undefined ? { temperature: o.temperature } : {}),
    }
  );
  const usage = { inputTokens: toInt(json.usage?.prompt_tokens), outputTokens: toInt(json.usage?.completion_tokens) };
  const msg = json.choices?.[0]?.message;
  if (msg?.refusal) throw Object.assign(new AiError('REFUSED', 'The AI declined this request', { status: 422 }), { usage });
  let output;
  try {
    output = JSON.parse(msg?.content ?? '');
  } catch {
    throw Object.assign(new AiError('INVALID_OUTPUT', 'The AI answer was not valid JSON', { retryable: true }), { usage });
  }
  return { output, ...usage };
}

async function anthropic(o) {
  const json = await post(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': o.apiKey, 'anthropic-version': '2023-06-01' },
    {
      model: o.model,
      max_tokens: o.maxOutputTokens,
      system: o.system,
      messages: [{ role: 'user', content: o.user }],
      tools: [{ name: 'submit_result', description: 'Return the final answer in this exact structure.', input_schema: o.jsonSchema }],
      tool_choice: { type: 'tool', name: 'submit_result' },
      ...(o.temperature !== null && o.temperature !== undefined ? { temperature: o.temperature } : {}),
    }
  );
  const usage = { inputTokens: toInt(json.usage?.input_tokens), outputTokens: toInt(json.usage?.output_tokens) };
  const block = (json.content || []).find((b) => b?.type === 'tool_use' && b?.name === 'submit_result');
  if (!block || typeof block.input !== 'object' || block.input === null) {
    throw Object.assign(new AiError('INVALID_OUTPUT', 'The AI answer was not in the expected format', { retryable: true }), { usage });
  }
  return { output: block.input, ...usage };
}

export async function complete(o) {
  if (o.provider === 'OPENAI') return openai(o);
  if (o.provider === 'ANTHROPIC') return anthropic(o);
  throw new AiError('BAD_REQUEST', 'Unknown AI provider', { status: 400 });
}
