// "Test connection" for each provider. Every outgoing request goes through SafeFetch.
// Secrets are only placed in headers (never logged); provider responses are NOT shown to the user
// (they might echo data back) — we turn the HTTP status into a short, safe message instead.
import { safeFetch, validateUrl, SafeFetchError } from '../../utils/safeFetch.js';
import { listInstagramAccounts, MetaError } from './meta/metaClient.js';

const TIMEOUT_MS = 10_000;

function fromStatus(status) {
  if (status >= 200 && status < 300) return { ok: true, message: 'Connection successful' };
  if (status === 401 || status === 403) return { ok: false, message: 'The provider rejected these credentials' };
  if (status === 404) return { ok: false, message: 'Not found — please check the IDs / URL' };
  if (status === 429) return { ok: false, message: 'The provider is rate-limiting requests — try again later' };
  if (status >= 500) return { ok: false, message: 'The provider is having problems — try again later' };
  return { ok: false, message: `Unexpected response from the provider (HTTP ${status})` };
}

function fromError(err) {
  if (err instanceof SafeFetchError) {
    if (err.code === 'TIMEOUT') return { ok: false, message: 'The provider did not answer in time' };
    if (err.code === 'BLOCKED_ADDRESS') return { ok: false, message: 'This address is not allowed (internal or private network)' };
    if (err.code === 'DNS_FAILED') return { ok: false, message: 'The host name could not be found' };
    return { ok: false, message: err.message };
  }
  return { ok: false, message: 'Could not reach the provider' };
}

async function httpCheck(url, headers) {
  try {
    const res = await safeFetch(url, { headers: { accept: 'application/json', ...headers }, timeoutMs: TIMEOUT_MS, maxBytes: 512 * 1024 });
    return fromStatus(res.status);
  } catch (err) {
    return fromError(err);
  }
}

const TESTERS = {
  async META_GRAPH(s) {
    try {
      const accounts = await listInstagramAccounts(s.userAccessToken);
      return accounts.length ? { ok: true, message: `Connected — ${accounts.length} Instagram business account(s)` } : { ok: false, message: 'No Instagram Business/Creator account linked to your Facebook Pages' };
    } catch (err) {
      return { ok: false, message: err instanceof MetaError ? err.message : 'Could not reach Meta' };
    }
  },

  OPENAI: (s, c) =>
    httpCheck('https://api.openai.com/v1/models', {
      authorization: `Bearer ${s.apiKey}`,
      ...(c.organizationId && { 'openai-organization': c.organizationId }),
    }),

  ANTHROPIC: (s) => httpCheck('https://api.anthropic.com/v1/models', { 'x-api-key': s.apiKey, 'anthropic-version': '2023-06-01' }),

  // Uses 1 search from your Brave quota
  BRAVE_SEARCH: (s) => httpCheck('https://api.search.brave.com/res/v1/web/search?q=test&count=1', { 'x-subscription-token': s.apiKey }),

  GOOGLE_SEARCH: (s, c) => {
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.search = new URLSearchParams({ key: s.apiKey, cx: c.searchEngineId, q: 'test', num: '1' }).toString();
    return httpCheck(url.toString(), {});
  },

  WHATSAPP_CLOUD: (s, c) =>
    httpCheck(`https://graph.facebook.com/${encodeURIComponent(c.phoneNumberId)}?fields=display_phone_number,verified_name`, {
      authorization: `Bearer ${s.accessToken}`,
    }),

  // Tenant-supplied URL → SafeFetch blocks internal addresses, redirects to them, other ports etc.
  DATA_PROVIDER: (s, c) => {
    const url = new URL(c.testPath || '/', c.baseUrl).toString();
    return httpCheck(url, { [c.authHeader.toLowerCase()]: s.apiKey });
  },

  async SMTP(s, c) {
    // The host is tenant-supplied → resolve it ourselves, block internal addresses, connect to the checked IP
    let target;
    try {
      target = await validateUrl(`http://${c.host}/`);
    } catch (err) {
      return fromError(err);
    }
    let nodemailer;
    try {
      nodemailer = (await import('nodemailer')).default;
    } catch {
      return { ok: false, message: 'Email package not installed on the server (run npm install)' };
    }
    const port = Number(c.port);
    const transport = nodemailer.createTransport({
      host: target.address,
      port,
      secure: port === 465,
      requireTLS: port !== 465, // never send the password over an unencrypted connection
      auth: { user: c.username, pass: s.password },
      tls: { servername: c.host }, // certificate must match the real host name
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
    try {
      await transport.verify();
      return { ok: true, message: 'Connection successful' };
    } catch (err) {
      if (err.code === 'EAUTH') return { ok: false, message: 'Login rejected — check the username and (app) password' };
      if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED'].includes(err.code)) return { ok: false, message: 'Could not reach the mail server on this port' };
      return { ok: false, message: 'The mail server refused the connection' };
    } finally {
      transport.close();
    }
  },
};

/** Tests can replace a tester (no real network in automated tests). */
export function registerTester(provider, fn) {
  TESTERS[provider] = fn;
}

export async function runTester(provider, secrets, config) {
  const tester = TESTERS[provider];
  if (!tester) return { ok: false, message: 'Testing is not available for this integration yet' };
  try {
    const result = await tester(secrets, config);
    return { ok: Boolean(result?.ok), message: String(result?.message || '').slice(0, 200) };
  } catch {
    return { ok: false, message: 'The test failed unexpectedly' };
  }
}
