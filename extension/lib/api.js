// Talks to the LeadFlow API. Rules:
//  - only https:// servers (plain http only for localhost while developing)
//  - access token (15 min) in chrome.storage.SESSION → gone when the browser closes
//  - refresh token in chrome.storage.LOCAL, rotated on every use
//  - never sends cookies, never follows redirects, 15 s timeout
const LOCAL = chrome.storage.local;
const SESSION = chrome.storage.session;
export const DEFAULT_SERVER = 'http://localhost:5000';

export class AuthError extends Error {}

/** Returns the origin if the address is allowed, else null. */
export function validServer(input) {
  try {
    const u = new URL(String(input || '').trim());
    if (u.username || u.password) return null;
    if (u.protocol === 'https:') return u.origin;
    if (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)) return u.origin;
  } catch {
    /* invalid */
  }
  return null;
}

export async function getServer() {
  const { server } = await LOCAL.get('server');
  return validServer(server) || DEFAULT_SERVER;
}

export async function setServer(origin) {
  await LOCAL.set({ server: origin });
}

export async function isPaired() {
  const { refreshToken } = await LOCAL.get('refreshToken');
  return Boolean(refreshToken);
}

export async function clearTokens() {
  await LOCAL.remove('refreshToken');
  await SESSION.remove(['accessToken', 'accessExp']);
}

async function saveTokens(d) {
  await SESSION.set({ accessToken: d.accessToken, accessExp: Date.now() + (d.expiresIn - 30) * 1000 });
  await LOCAL.set({ refreshToken: d.refreshToken });
}

async function raw(path, { method = 'GET', body, token } = {}) {
  const server = await getServer();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${server}/api/v1/extension${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: ctrl.signal,
    });
    let json = {};
    try {
      json = await res.json();
    } catch {
      /* not JSON */
    }
    return { ok: res.ok, status: res.status, data: json.data, message: typeof json.message === 'string' ? json.message : '', errors: Array.isArray(json.errors) ? json.errors : [], details: json.details || null };
  } catch {
    return { ok: false, status: 0, message: 'Cannot reach the LeadFlow server. Check the address and that it is running.', errors: [] };
  } finally {
    clearTimeout(timer);
  }
}

export async function pair(code, deviceName) {
  const res = await raw('/pair', { method: 'POST', body: { code, deviceName } });
  if (res.ok) await saveTokens(res.data);
  return res;
}

let refreshing = null;
async function refreshOnce() {
  if (!refreshing) {
    refreshing = (async () => {
      const { refreshToken } = await LOCAL.get('refreshToken');
      if (!refreshToken) throw new AuthError();
      const res = await raw('/token', { method: 'POST', body: { refreshToken } });
      if (!res.ok) {
        if (res.status === 401) await clearTokens();
        throw res.status === 401 ? new AuthError() : new Error(res.message || 'Could not refresh');
      }
      await saveTokens(res.data);
      return res.data.accessToken;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function accessToken() {
  const { accessToken: t, accessExp } = await SESSION.get(['accessToken', 'accessExp']);
  if (t && accessExp > Date.now()) return t;
  return refreshOnce();
}

/** Authenticated call; refreshes once on 401. */
export async function call(path, opts = {}) {
  let res = await raw(path, { ...opts, token: await accessToken() });
  if (res.status === 401) {
    await SESSION.remove(['accessToken', 'accessExp']);
    res = await raw(path, { ...opts, token: await refreshOnce() });
  }
  if (res.status === 401) {
    await clearTokens();
    throw new AuthError();
  }
  return res;
}

export async function logout() {
  try {
    await call('/logout', { method: 'POST' });
  } catch {
    /* already signed out */
  }
  await clearTokens();
}
