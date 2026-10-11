// Minimal Meta Graph API client. Every call:
//  - goes through SafeFetch (fixed graph.facebook.com host)
//  - adds appsecret_proof (HMAC of the token with the app secret) → a stolen token alone is useless
//    from another app/server
//  - turns Graph errors into short, safe messages (tokens never appear in errors or logs)
import crypto from 'node:crypto';
import env from '../../../config/env.js';
import { safeFetch } from '../../../utils/safeFetch.js';

export class MetaError extends Error {
  constructor(message, { code = null, subcode = null, metaMessage = null, reconnect = false, rateLimited = false, network = false } = {}) {
    super(message);
    this.name = 'MetaError';
    this.code = code;
    this.subcode = subcode;
    this.metaMessage = metaMessage; // Meta's own explanation (tokens/secrets removed) — for logs and diagnosis
    this.reconnect = reconnect;
    this.rateLimited = rateLimited;
    this.network = network;
  }
}

/** Meta's error text without anything that could be a token/secret/code (long random strings). */
export function safeMetaMessage(msg) {
  return String(msg || '')
    .replace(/[A-Za-z0-9_\-]{32,}/g, '…')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200) || null;
}

/** Turns a failed connection into a short reason the app can explain to a beginner. */
export function diagnoseMetaError(err, step) {
  const m = String(err?.metaMessage || '').toLowerCase();
  const code = err?.code;
  if (err?.network) return 'meta_unreachable';
  if (code === 191 || /redirect_uri|redirect uri|url blocked|domain of this url/.test(m)) return 'redirect_uri_mismatch';
  if (/client secret|client_secret|appsecret|app secret/.test(m)) return 'bad_app_secret';
  if (/client_id|app id|invalid application|application does not exist/.test(m)) return 'bad_app_id';
  if (/version/.test(m) && /unknown|unsupported|invalid|deprecated/.test(m)) return 'bad_graph_version';
  if (/verification code|code has (expired|been used)|authorization code/.test(m)) return 'expired_or_invalid';
  if (step === 'accounts' && (code === 10 || code === 200 || /permission/.test(m))) return 'missing_permission';
  return 'meta_refused';
}

export const isMetaConfigured = () => Boolean(env.META_APP_ID && env.META_APP_SECRET);
export const metaRedirectUri = () => `${env.API_PUBLIC_URL.replace(/\/$/, '')}/api/v1/integrations/meta/oauth/callback`;
const base = () => `https://graph.facebook.com/${env.META_GRAPH_VERSION}`;
const proof = (token) => crypto.createHmac('sha256', env.META_APP_SECRET).update(token).digest('hex');

// Tests replace the transport (no real network in automated tests)
let transport = (url) => safeFetch(url, { timeoutMs: 15000, maxBytes: 2 * 1024 * 1024, headers: { accept: 'application/json' } });
export function setMetaTransport(fn) {
  transport = fn;
}

async function call(path, params, { token } = {}) {
  const url = new URL(`${base()}${path}`);
  const qs = { ...params };
  if (token) {
    qs.access_token = token;
    qs.appsecret_proof = proof(token);
  }
  url.search = new URLSearchParams(qs).toString();

  let res;
  try {
    res = await transport(url.toString());
  } catch (err) {
    // e.g. "network: TIMEOUT" / "network: NETWORK" / "network: DNS_FAILED" — shown in the server log
    throw new MetaError('Could not reach Meta — try again later', { rateLimited: true, network: true, metaMessage: `network: ${err?.code || err?.name || 'error'}` });
  }
  let body = {};
  try {
    body = res.json();
  } catch {
    /* ignore */
  }
  if (res.status >= 200 && res.status < 300 && !body.error) return body;

  const code = body?.error?.code;
  const extra = { code, subcode: body?.error?.error_subcode ?? null, metaMessage: safeMetaMessage(body?.error?.message) };
  if (code === 190 || code === 102 || res.status === 401) throw new MetaError('The Meta connection expired or was removed — please reconnect', { ...extra, reconnect: true });
  if ([4, 17, 32, 613].includes(code) || res.status === 429) throw new MetaError('Meta rate limit reached — will retry later', { ...extra, rateLimited: true });
  if (code === 10 || code === 200) throw new MetaError('Missing permission — the app needs "Instagram Public Content Access" approved by Meta', extra);
  throw new MetaError('Meta refused the request', extra);
}

/** The URL the browser is sent to for "Login with Facebook". */
export function buildAuthUrl(state) {
  const url = new URL(`https://www.facebook.com/${env.META_GRAPH_VERSION}/dialog/oauth`);
  url.search = new URLSearchParams({
    client_id: env.META_APP_ID,
    redirect_uri: metaRedirectUri(),
    state,
    response_type: 'code',
    // minimal scopes for hashtag search on a Business/Creator account linked to a Page
    scope: 'instagram_basic,pages_show_list,business_management',
  }).toString();
  return url.toString();
}

export async function exchangeCode(code) {
  return call('/oauth/access_token', { client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, redirect_uri: metaRedirectUri(), code });
}

/** Short-lived (~1 h) → long-lived (~60 days) user token */
export async function exchangeLongLived(shortToken) {
  return call('/oauth/access_token', { grant_type: 'fb_exchange_token', client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, fb_exchange_token: shortToken });
}

/** Facebook Pages the user manages that have an Instagram Business/Creator account linked */
export async function listInstagramAccounts(token) {
  const data = await call('/me/accounts', { fields: 'id,name,instagram_business_account{id,username}', limit: '50' }, { token });
  return (data.data || [])
    .filter((p) => p.instagram_business_account?.id)
    .map((p) => ({ pageId: String(p.id), pageName: String(p.name || '').slice(0, 100), igUserId: String(p.instagram_business_account.id), igUsername: String(p.instagram_business_account.username || '').slice(0, 60) }));
}

export async function findHashtagId(igUserId, token, hashtag) {
  const data = await call('/ig_hashtag_search', { user_id: igUserId, q: hashtag }, { token });
  return data?.data?.[0]?.id ? String(data.data[0].id) : null;
}

/** Public posts with this hashtag from the last 24 hours. NOTE: Meta does NOT return who posted them. */
export async function recentMedia(hashtagId, igUserId, token, limit = 50) {
  const data = await call(`/${encodeURIComponent(hashtagId)}/recent_media`, {
    user_id: igUserId,
    fields: 'id,caption,media_type,permalink,timestamp,like_count,comments_count',
    limit: String(Math.min(50, limit)),
  }, { token });
  return data.data || [];
}
