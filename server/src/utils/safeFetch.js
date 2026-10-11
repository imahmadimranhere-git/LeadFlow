// SafeFetch — the ONLY way the server may fetch a URL that came from a user, lead, CSV, signal
// or tenant setting. Protects against SSRF (Server-Side Request Forgery): tricking OUR server into
// calling internal addresses (database, cloud metadata 169.254.169.254, admin panels...).
//
// Rules: http/https only · no user:pass@ in URL · ports 80/443 only · DNS is resolved by us and
// EVERY address must be public · the connection is pinned to that checked IP (stops DNS rebinding)
// · every redirect is re-checked · timeout · max response size · optional content-type allow-list
// · no cookies/credentials are ever forwarded automatically.
//
// No external packages: only Node built-ins.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns/promises';

export class SafeFetchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SafeFetchError';
    this.code = code;
  }
}

// ---------------------------------------------------------------- address policy

const blockList = new net.BlockList();
const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const V6_BLOCKED = [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23],
  ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
];
for (const [a, p] of V4_BLOCKED) blockList.addSubnet(a, p, 'ipv4');
for (const [a, p] of V6_BLOCKED) blockList.addSubnet(a, p, 'ipv6');

/** IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1) → "127.0.0.1" */
function mappedV4(ip) {
  const m = /^::ffff:(?:0:)?(.+)$/i.exec(ip);
  if (!m) return null;
  if (net.isIPv4(m[1])) return m[1];
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(m[1]);
  if (!hex) return null;
  const a = parseInt(hex[1], 16);
  const b = parseInt(hex[2], 16);
  return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
}

/** true only for normal, public internet addresses */
export function isPublicAddress(ip) {
  const v4 = net.isIPv4(ip) ? ip : mappedV4(ip);
  if (v4) return !blockList.check(v4, 'ipv4');
  if (net.isIPv6(ip)) return !blockList.check(ip, 'ipv6');
  return false;
}

// ---------------------------------------------------------------- URL validation

const DEFAULTS = {
  allowedPorts: [80, 443],
  timeoutMs: 8000,
  maxBytes: 1024 * 1024, // 1 MB
  maxRedirects: 3,
  allowedContentTypes: null, // e.g. ['application/json']
  addressPolicy: isPublicAddress,
  resolve: (host) => dns.lookup(host, { all: true, verbatim: true }),
};

/**
 * Checks a URL and resolves its host. Returns { url, address, family } or throws SafeFetchError.
 * The WHATWG URL parser already turns tricks like http://2130706433, http://0x7f.1 or
 * http://0177.0.0.1 into 127.0.0.1 — so they are caught by the address check below.
 */
export async function validateUrl(input, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  let url;
  try {
    url = new URL(String(input));
  } catch {
    throw new SafeFetchError('INVALID_URL', 'Invalid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new SafeFetchError('BLOCKED_PROTOCOL', 'Only http and https URLs are allowed');
  if (url.username || url.password) throw new SafeFetchError('BLOCKED_CREDENTIALS', 'URLs with a username or password are not allowed');
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!o.allowedPorts.includes(port)) throw new SafeFetchError('BLOCKED_PORT', 'This port is not allowed');

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new SafeFetchError('INVALID_URL', 'Invalid URL');

  let addresses;
  if (net.isIP(host)) {
    addresses = [{ address: host, family: net.isIPv4(host) ? 4 : 6 }];
  } else {
    if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new SafeFetchError('BLOCKED_ADDRESS', 'This address is not allowed');
    try {
      addresses = await o.resolve(host);
    } catch {
      throw new SafeFetchError('DNS_FAILED', 'The website address could not be found');
    }
  }
  if (!addresses?.length) throw new SafeFetchError('DNS_FAILED', 'The website address could not be found');
  // EVERY resolved address must be public (an attacker's DNS could return one public + one private)
  if (!addresses.every((a) => o.addressPolicy(a.address))) throw new SafeFetchError('BLOCKED_ADDRESS', 'This address is not allowed');

  // IPv4 first: many home/mobile networks (e.g. in Pakistan) resolve IPv6 addresses but cannot route
  // IPv6 traffic. Browsers silently fall back; a pinned connection must do the same (see safeFetch).
  const ordered = [...addresses].sort((a, b) => (a.family === 4 ? 0 : 1) - (b.family === 4 ? 0 : 1));
  return { url, port, address: ordered[0].address, family: ordered[0].family, addresses: ordered };
}

// ---------------------------------------------------------------- request

function requestOnce(target, { method, headers, body, timeoutMs, maxBytes }) {
  const { url, port, address, family } = target;
  const lib = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port,
        path: `${url.pathname}${url.search}`,
        method,
        headers: { 'user-agent': 'LeadFlowBot/1.0 (+safe-fetch)', accept: '*/*', ...headers },
        // Pin the connection to the IP we already checked → DNS rebinding can't swap it
        // Node 20+ asks for ALL addresses ({ all: true }, "happy eyeballs") and then expects an ARRAY —
        // answering with a single address made every request to a host NAME fail ("Could not connect").
        lookup: (_host, lookupOpts, cb) => (lookupOpts && lookupOpts.all ? cb(null, [{ address, family }]) : cb(null, address, family)),
        servername: net.isIP(url.hostname) ? undefined : url.hostname, // TLS SNI + certificate check by name
        agent: false, // no connection reuse, no shared cookies
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy();
            reject(new SafeFetchError('TOO_LARGE', 'Response is too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new SafeFetchError('TIMEOUT', 'The request took too long')));
    req.on('error', (err) => reject(err instanceof SafeFetchError ? err : new SafeFetchError('NETWORK', 'Could not connect')));
    const timer = setTimeout(() => req.destroy(new SafeFetchError('TIMEOUT', 'The request took too long')), timeoutMs);
    req.on('close', () => clearTimeout(timer));
    if (body) req.write(body);
    req.end();
  });
}

/** Try the checked addresses one by one (max 3) when a connection cannot be made at all. */
async function requestWithFallback(target, o) {
  const list = (target.addresses?.length ? target.addresses : [{ address: target.address, family: target.family }]).slice(0, 3);
  let lastErr;
  for (const a of list) {
    try {
      return await requestOnce({ ...target, address: a.address, family: a.family }, o);
    } catch (err) {
      lastErr = err;
      if (!(err instanceof SafeFetchError) || !['NETWORK', 'TIMEOUT'].includes(err.code)) throw err;
    }
  }
  throw lastErr;
}

/**
 * safeFetch(url, { method, headers, body, timeoutMs, maxBytes, maxRedirects, allowedContentTypes })
 * → { status, headers, body: Buffer, url: finalUrl, text(), json() }
 */
export async function safeFetch(input, opts = {}) {
  const o = { ...DEFAULTS, method: 'GET', headers: {}, body: null, ...opts };
  if (!['GET', 'HEAD', 'POST'].includes(o.method)) throw new SafeFetchError('BLOCKED_METHOD', 'Method not allowed');

  let current = String(input);
  for (let hop = 0; hop <= o.maxRedirects; hop += 1) {
    const target = await validateUrl(current, o); // re-checked on EVERY hop
    const res = await requestWithFallback(target, o);

    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
      if (hop === o.maxRedirects) throw new SafeFetchError('TOO_MANY_REDIRECTS', 'Too many redirects');
      current = new URL(res.headers.location, target.url).toString();
      // Never forward secrets to another host after a redirect
      if (new URL(current).host !== target.url.host) o.headers = {};
      if (res.status === 303) {
        o.method = 'GET';
        o.body = null;
      }
      continue;
    }

    if (o.allowedContentTypes && res.status < 400) {
      const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!o.allowedContentTypes.includes(type)) throw new SafeFetchError('BLOCKED_CONTENT_TYPE', 'Unexpected content type');
    }
    return {
      ...res,
      url: current,
      text: () => res.body.toString('utf8'),
      json: () => JSON.parse(res.body.toString('utf8')),
    };
  }
  throw new SafeFetchError('TOO_MANY_REDIRECTS', 'Too many redirects');
}
