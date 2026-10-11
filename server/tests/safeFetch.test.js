// PHASE 8 — SSRF PROTECTION (SafeFetch). Uses only Node built-ins: no database needed.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { safeFetch, validateUrl, isPublicAddress } from '../src/utils/safeFetch.js';

const blocked = async (url, code, opts) =>
  assert.rejects(() => validateUrl(url, opts), (err) => {
    assert.equal(err.name, 'SafeFetchError');
    if (code) assert.equal(err.code, code, `${url} → ${err.code}`);
    return true;
  });

describe('SafeFetch: address checks', () => {
  it('private, loopback, link-local and cloud-metadata IPs are blocked', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.5', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe']) {
      assert.equal(isPublicAddress(ip), false, ip);
    }
  });

  it('normal public IPs are allowed', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(isPublicAddress(ip), true, ip);
  });

  it('blocks internal IP literals, including tricky encodings', async () => {
    for (const url of [
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://2130706433/', // decimal 127.0.0.1
      'http://0x7f000001/', // hex
      'http://0177.0.0.1/', // octal
      'http://127.1/', // short form
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/', // IPv4-mapped IPv6
      'http://[::ffff:a9fe:a9fe]/', // 169.254.169.254 mapped
    ]) {
      await blocked(url, 'BLOCKED_ADDRESS');
    }
  });

  it('blocks localhost-style names without even asking DNS', async () => {
    await blocked('http://localhost/', 'BLOCKED_ADDRESS');
    await blocked('http://admin.localhost/', 'BLOCKED_ADDRESS');
    await blocked('http://db.internal/', 'BLOCKED_ADDRESS');
  });

  it('blocks a public-looking name whose DNS points to a private IP', async () => {
    const resolve = async () => [{ address: '10.0.0.5', family: 4 }];
    await blocked('https://evil.example/', 'BLOCKED_ADDRESS', { resolve });
  });

  it('blocks if ANY of the DNS answers is private (mixed answers)', async () => {
    const resolve = async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }];
    await blocked('https://evil.example/', 'BLOCKED_ADDRESS', { resolve });
  });

  it('allows a normal public name and pins the checked IP', async () => {
    const resolve = async () => [{ address: '93.184.216.34', family: 4 }];
    const t = await validateUrl('https://example.com/path?q=1', { resolve });
    assert.equal(t.address, '93.184.216.34');
    assert.equal(t.port, 443);
  });

  it('IPv4 is tried first (home networks often resolve IPv6 but cannot route it)', async () => {
    const resolve = async () => [{ address: '2a03:2880:f12c:83:face:b00c:0:25de', family: 6 }, { address: '157.240.1.1', family: 4 }];
    const t = await validateUrl('https://graph.facebook.com/v26.0/me', { resolve });
    assert.equal(t.address, '157.240.1.1');
    assert.deepEqual(t.addresses.map((a) => a.family), [4, 6]);
  });
});

describe('SafeFetch: URL rules', () => {
  it('only http/https', async () => {
    for (const url of ['file:///etc/passwd', 'ftp://example.com/', 'gopher://example.com/', 'javascript:alert(1)', 'data:text/html,hi']) {
      await blocked(url, 'BLOCKED_PROTOCOL');
    }
  });

  it('no username/password in the URL', async () => {
    await blocked('https://user:pass@example.com/', 'BLOCKED_CREDENTIALS');
  });

  it('only ports 80/443', async () => {
    await blocked('http://example.com:8080/', 'BLOCKED_PORT');
    await blocked('http://example.com:6379/', 'BLOCKED_PORT'); // Redis
    await blocked('https://example.com:27017/', 'BLOCKED_PORT'); // MongoDB
  });

  it('garbage input is rejected', async () => {
    await blocked('not a url', 'INVALID_URL');
  });
});

// For the request tests we run a tiny local server. Locally only, the test allows 127.0.0.1
// and its port — everything else still goes through the normal public-address rules.
describe('SafeFetch: real requests (local test server)', () => {
  let server;
  let base;
  let port;
  const opts = () => ({
    allowedPorts: [port],
    addressPolicy: (ip) => ip === '127.0.0.1' || isPublicAddress(ip),
    timeoutMs: 1500,
  });

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/ok') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ hello: 'world', cookie: req.headers.cookie || null }));
      } else if (req.url === '/to-metadata') {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        res.end();
      } else if (req.url === '/to-decimal-localhost') {
        res.writeHead(302, { location: 'http://2130706433:80/' });
        res.end();
      } else if (req.url.startsWith('/loop')) {
        res.writeHead(302, { location: '/loop' });
        res.end();
      } else if (req.url === '/hop') {
        res.writeHead(301, { location: '/ok' });
        res.end();
      } else if (req.url === '/big') {
        res.setHeader('content-type', 'text/html');
        res.end('x'.repeat(200_000));
      } else if (req.url === '/html') {
        res.setHeader('content-type', 'text/html');
        res.end('<html></html>');
      } else if (req.url === '/slow') {
        // never answers
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
    base = `http://127.0.0.1:${port}`;
  });
  after(() => {
    server.closeAllConnections?.();
    server.close();
  });

  it('fetches a normal response', async () => {
    const res = await safeFetch(`${base}/ok`, opts());
    assert.equal(res.status, 200);
    assert.equal(res.json().hello, 'world');
  });

  it('follows a safe redirect', async () => {
    const res = await safeFetch(`${base}/hop`, opts());
    assert.equal(res.json().hello, 'world');
  });

  it('REDIRECT to cloud metadata is blocked (re-checked on every hop)', async () => {
    // port 80 allowed too, so it is really the ADDRESS rule that stops it
    await assert.rejects(() => safeFetch(`${base}/to-metadata`, { ...opts(), allowedPorts: [port, 80] }), { code: 'BLOCKED_ADDRESS' });
  });

  it('REDIRECT to an encoded internal address is blocked', async () => {
    await assert.rejects(() => safeFetch(`${base}/to-decimal-localhost`, { ...opts(), allowedPorts: [port, 80], addressPolicy: isPublicAddress }), {
      code: 'BLOCKED_ADDRESS',
    });
  });

  it('endless redirects stop', async () => {
    await assert.rejects(() => safeFetch(`${base}/loop`, opts()), { code: 'TOO_MANY_REDIRECTS' });
  });

  it('responses over the size limit are cut off', async () => {
    await assert.rejects(() => safeFetch(`${base}/big`, { ...opts(), maxBytes: 50_000 }), { code: 'TOO_LARGE' });
  });

  it('a server that never answers times out', async () => {
    await assert.rejects(() => safeFetch(`${base}/slow`, { ...opts(), timeoutMs: 300 }), { code: 'TIMEOUT' });
  });

  it('unexpected content types are refused when an allow-list is given', async () => {
    await assert.rejects(() => safeFetch(`${base}/html`, { ...opts(), allowedContentTypes: ['application/json'] }), { code: 'BLOCKED_CONTENT_TYPE' });
  });

  it('only GET/HEAD/POST are allowed', async () => {
    await assert.rejects(() => safeFetch(`${base}/ok`, { ...opts(), method: 'DELETE' }), { code: 'BLOCKED_METHOD' });
  });

  it('no cookies are sent automatically', async () => {
    const res = await safeFetch(`${base}/ok`, opts());
    assert.equal(res.json().cookie, null);
  });

  it('a host NAME works, not only an IP (Node 20+ asks DNS for ALL addresses) — regression', async () => {
    // Before the fix every name-based request (graph.facebook.com, Brave, website audits) failed with NETWORK
    const res = await safeFetch(`http://lf-name.example:${port}/ok`, { ...opts(), resolve: async () => [{ address: '127.0.0.1', family: 4 }] });
    assert.equal(res.json().hello, 'world');
  });

  it('if the first address cannot be reached, the next checked address is used', async () => {
    // 127.0.0.2 has nothing listening → connection refused → falls back to 127.0.0.1
    const resolve = async () => [{ address: '127.0.0.2', family: 4 }, { address: '127.0.0.1', family: 4 }];
    const res = await safeFetch(`http://lf-fallback.example:${port}/ok`, {
      ...opts(),
      resolve,
      addressPolicy: (ip) => ip === '127.0.0.1' || ip === '127.0.0.2',
    });
    assert.equal(res.status, 200);
  });
});
