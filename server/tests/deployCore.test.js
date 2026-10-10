// PHASE 29 — deployment safety, tested without a server: the Vercel-only "front door" guard, the
// production configuration checker, the .env parser, and the post-deploy smoke-test verdicts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { makeOriginGuard } from '../src/utils/originGuard.js';
import { checkProductionEnv, parseEnvText } from '../src/config/productionChecks.js';
import { evaluateSmoke } from '../scripts/lib/smokeChecks.mjs';

const SECRET = crypto.randomBytes(32).toString('hex');
function run(guard, url, headers = {}) {
  const req = { originalUrl: url, headers: { ...headers } };
  let status = null;
  let nextCalled = false;
  const res = { status(s) { status = s; return this; }, json() { return this; } };
  guard(req, res, () => { nextCalled = true; });
  return { status, nextCalled, req };
}

describe('Origin guard (only through Vercel)', () => {
  it('off when no secret is configured', () => {
    assert.equal(run(makeOriginGuard(undefined), '/api/v1/leads').nextCalled, true);
  });
  it('right secret passes (and is removed from the request); wrong / missing → 403', () => {
    let blocked = 0;
    const g = makeOriginGuard(SECRET, { onBlocked: () => { blocked += 1; } });
    const ok = run(g, '/api/v1/leads', { 'x-origin-secret': SECRET });
    assert.equal(ok.nextCalled, true);
    assert.equal(ok.req.headers['x-origin-secret'], undefined, 'never passed on / logged');
    assert.equal(run(g, '/api/v1/leads', { 'x-origin-secret': `${SECRET}x` }).status, 403);
    assert.equal(run(g, '/api/v1/leads').status, 403);
    assert.equal(run(g, '/api/v1/auth/login', { 'x-origin-secret': ['a', 'b'] }).status, 403, 'array header');
    assert.equal(blocked, 3);
  });
  it('webhooks and the health check stay open (Meta / payment providers / Render can\'t go through Vercel)', () => {
    const g = makeOriginGuard(SECRET);
    for (const u of ['/api/v1/webhooks/whatsapp', '/api/v1/webhooks/payments/stripe?x=1', '/api/v1/health', '/api/v1/health/']) assert.equal(run(g, u).nextCalled, true, u);
    for (const u of ['/api/v1/healthz', '/api/v1/webhooksx', '/api/v1/leads?next=/api/v1/health']) assert.equal(run(g, u).status, 403, u);
  });
});

const GOOD = {
  NODE_ENV: 'production',
  JWT_SECRET: crypto.randomBytes(48).toString('base64url'),
  JWT_REFRESH_SECRET: crypto.randomBytes(48).toString('base64url'),
  ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
  ORIGIN_SECRET: SECRET,
  MONGODB_URI: ['mongodb+srv://leadflow_app', 'pw@cluster0.abcd.mongodb.net/leadflow?retryWrites=true'].join(':'),
  CLIENT_URL: 'https://app.example.com',
  API_PUBLIC_URL: 'https://app.example.com',
  TRUST_PROXY_HOPS: '2',
  EXTENSION_ORIGINS: `chrome-extension://${'a'.repeat(32)}`,
  PLATFORM_SMTP_HOST: 'smtp-relay.example.com',
  PLATFORM_SMTP_PORT: '2525',
  PLATFORM_EMAIL_FROM: 'LeadFlow <no-reply@example.com>',
};
const keys = (list) => list.map((x) => x.key);

describe('Production configuration check', () => {
  it('a correct setup passes with no warnings; values are never echoed', () => {
    const r = checkProductionEnv(GOOD);
    assert.deepEqual([r.ok, r.errors, r.warnings], [true, [], []]);
    const all = JSON.stringify(checkProductionEnv({ ...GOOD, NODE_ENV: 'development' }));
    for (const v of [GOOD.JWT_SECRET, GOOD.ENCRYPTION_KEY, GOOD.ORIGIN_SECRET]) assert.ok(!all.includes(v));
  });
  it('blocks the dangerous mistakes', () => {
    const r = checkProductionEnv({ ...GOOD, NODE_ENV: 'development', JWT_SECRET: 'test_jwt_secret_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', JWT_REFRESH_SECRET: 'short', ENCRYPTION_KEY: 'a'.repeat(64), CLIENT_URL: 'http://localhost:5173', API_PUBLIC_URL: 'http://api.example.com', MONGODB_URI: 'mongodb://localhost:27017/leadflow', META_APP_ID: '123456789' });
    assert.equal(r.ok, false);
    for (const k of ['NODE_ENV', 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY', 'MONGODB_URI', 'CLIENT_URL', 'API_PUBLIC_URL', 'META_APP_SECRET']) assert.ok(keys(r.errors).includes(k), k);
    assert.ok(keys(checkProductionEnv({ ...GOOD, CLIENT_URL: 'https://*.example.com' }).errors).includes('CLIENT_URL'));
    assert.ok(keys(checkProductionEnv({ ...GOOD, JWT_REFRESH_SECRET: GOOD.JWT_SECRET }).errors).includes('JWT_REFRESH_SECRET'));
    assert.ok(keys(checkProductionEnv({ ...GOOD, ORIGIN_SECRET: '' }).errors).includes('ORIGIN_SECRET'), 'proxy without the secret');
    assert.ok(keys(checkProductionEnv({ ...GOOD, EXTENSION_ORIGINS: 'chrome-extension://abc' }).errors).includes('EXTENSION_ORIGINS'));
  });
  it('warns about the risky-but-allowed choices', () => {
    const w = (over) => keys(checkProductionEnv({ ...GOOD, ...over }).warnings);
    assert.ok(w({ MONGODB_URI: GOOD.MONGODB_URI.replace('leadflow_app', 'admin') }).includes('MONGODB_URI'), 'admin user');
    assert.ok(w({ TRUST_PROXY_HOPS: '1' }).includes('TRUST_PROXY_HOPS'));
    assert.ok(w({ API_PUBLIC_URL: 'https://leadflow-api.onrender.com' }).includes('API_PUBLIC_URL'), 'third-party cookie problem');
    assert.ok(w({ PLATFORM_SMTP_PORT: '587' }).includes('PLATFORM_SMTP_PORT'));
    assert.ok(w({ PLATFORM_SMTP_HOST: '' }).includes('PLATFORM_SMTP_HOST'));
    assert.ok(w({ EXTENSION_ORIGINS: '' }).includes('EXTENSION_ORIGINS'));
    assert.ok(w({ LOG_LEVEL: 'debug' }).includes('LOG_LEVEL'));
  });
  it('.env parser: quotes, comments, blanks, "=" inside values', () => {
    assert.deepEqual(parseEnvText('# c\nA=1\n\nB="x y" \nC=\'q\'\nD=val # note\nE=a=b\nbad line\n'), { A: '1', B: 'x y', C: 'q', D: 'val', E: 'a=b' });
  });
});

describe('Post-deploy smoke test verdicts', () => {
  const html = { status: 200, headers: { 'content-type': 'text/html', 'content-security-policy': "default-src 'self'; frame-ancestors 'none'", 'strict-transport-security': 'max-age=31536000', 'x-frame-options': 'DENY' } };
  const healthy = {
    app: html,
    deepLink: html,
    http: { status: 308, headers: { location: 'https://app.example.com/' } },
    health: { status: 200, headers: { 'cache-control': 'no-store' }, json: { data: { db: 'connected' } } },
    protected: { status: 401, headers: {} },
    cors: { status: 200, headers: {} },
    direct: { status: 403, headers: {} },
    directHealth: { status: 200, headers: {} },
  };
  it('healthy deployment passes every check', () => {
    const r = evaluateSmoke(healthy);
    assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => !c.ok)));
  });
  it('each typical mistake is reported with a useful hint', () => {
    const fail = (over) => evaluateSmoke({ ...healthy, ...over }).checks.filter((c) => !c.ok);
    assert.match(fail({ health: { status: 403, headers: {} } }).map((c) => c.hint).join(' '), /ORIGIN_SECRET differs/);
    assert.match(fail({ health: { status: 503, headers: { 'cache-control': 'no-store' }, json: { data: { db: 'disconnected' } } } })[0].hint, /MongoDB is not connected/);
    assert.match(fail({ cors: { status: 200, headers: { 'access-control-allow-origin': 'https://evil.example' } } })[0].hint, /CLIENT_URL/);
    assert.match(fail({ direct: { status: 401, headers: {} } })[0].hint, /ORIGIN_SECRET not set/);
    assert.match(fail({ app: { status: 200, headers: { 'content-type': 'text/html' } } }).map((c) => c.name).join(' '), /Content-Security-Policy/);
    assert.equal(fail({ protected: { status: 200, headers: {} } }).length, 1);
  });
});
