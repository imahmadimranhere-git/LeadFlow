// PHASE 3 — AUTHENTICATION TESTS
import './helpers/setupEnv.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import RefreshToken from '../src/models/RefreshToken.js';
import { runAsSystem } from '../src/utils/tenantContext.js';
import { hashToken } from '../src/services/auth/tokenService.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';
import { ORIGIN, GOOD_PASSWORD, uniqueEmail, bearer, refreshCookieFrom, registerTenant } from './helpers/authHelpers.js';

const asSystem = (fn) => runAsSystem('test', fn);
const refresh = (cookie, origin = ORIGIN) => {
  const req = request(app).post('/api/v1/auth/refresh');
  if (origin) req.set('Origin', origin);
  if (cookie) req.set('Cookie', cookie);
  return req;
};

describe('Register', () => {
  before(startTestDb);
  after(stopTestDb);

  it('creates a company (tenant) + owner and logs them in', async () => {
    const owner = await registerTenant();
    assert.equal(owner.user.role, 'TENANT_OWNER');
    assert.equal(owner.tenant.status, 'TRIAL');
    assert.ok(owner.token);
  });

  it('refresh token goes in a secure HttpOnly cookie, never in the JSON body', async () => {
    const owner = await registerTenant();
    const setCookie = owner.res.headers['set-cookie'].join(';');
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Path=\/api\/v1\/auth/i);
    assert.equal(owner.res.body.data.refreshToken, undefined);
  });

  it('never returns password hash or security internals', async () => {
    const owner = await registerTenant();
    const json = JSON.stringify(owner.res.body);
    for (const secret of ['passwordHash', 'tokenVersion', 'failedLoginCount', 'lockUntil', '$2']) {
      assert.ok(!json.includes(secret), `response leaks ${secret}`);
    }
  });

  it('stores the password as a bcrypt hash, not plain text', async () => {
    const owner = await registerTenant();
    const user = await asSystem(() => User.findOne({ email: owner.email }).select('+passwordHash'));
    assert.ok(user.passwordHash.startsWith('$2'));
    assert.notEqual(user.passwordHash, GOOD_PASSWORD);
  });

  it('stores refresh tokens hashed in the database', async () => {
    const owner = await registerTenant();
    const raw = owner.cookie.split('=')[1];
    assert.equal(await RefreshToken.findOne({ tokenHash: raw }), null);
    assert.ok(await RefreshToken.findOne({ tokenHash: hashToken(raw) }));
  });

  it('rejects weak and common passwords', async () => {
    for (const password of ['short1', 'onlyletterspassword', 'password123']) {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ name: 'X', email: uniqueEmail(), password, companyName: 'X Co' });
      assert.equal(res.status, 400, `accepted weak password: ${password}`);
    }
  });

  it('rejects attempts to set role / tenantId at signup (mass assignment)', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'X', email: uniqueEmail(), password: GOOD_PASSWORD, companyName: 'X Co', role: 'SUPER_ADMIN',
    });
    assert.equal(res.status, 400);
  });

  it('rejects a duplicate email', async () => {
    const owner = await registerTenant();
    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'Y', email: owner.email, password: GOOD_PASSWORD, companyName: 'Y Co',
    });
    assert.equal(res.status, 409);
  });
});

describe('Login', () => {
  before(startTestDb);
  after(stopTestDb);

  it('logs in with correct credentials', async () => {
    const owner = await registerTenant();
    const res = await request(app).post('/api/v1/auth/login').send({ email: owner.email, password: owner.password });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.accessToken);
    assert.ok(refreshCookieFrom(res));
  });

  it('wrong password and unknown email give the SAME message (no account guessing)', async () => {
    const owner = await registerTenant();
    const wrong = await request(app).post('/api/v1/auth/login').send({ email: owner.email, password: 'Wrong123456' });
    const unknown = await request(app).post('/api/v1/auth/login').send({ email: uniqueEmail(), password: 'Wrong123456' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.message, unknown.body.message);
  });

  it('locks the account after 5 wrong passwords (brute-force protection)', async () => {
    const owner = await registerTenant();
    for (let i = 0; i < 5; i += 1) {
      await request(app).post('/api/v1/auth/login').send({ email: owner.email, password: 'Wrong123456' });
    }
    const res = await request(app).post('/api/v1/auth/login').send({ email: owner.email, password: owner.password });
    assert.equal(res.status, 401, 'correct password should be refused while locked');
  });
});

describe('Access tokens', () => {
  let owner;
  before(async () => {
    await startTestDb();
    owner = await registerTenant();
  });
  after(stopTestDb);

  const claims = () => ({ tid: owner.tenant.id, tv: 0 });
  const opts = { subject: undefined, issuer: 'leadflow-api', audience: 'leadflow-app' };

  it('protected route without a token → 401', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    assert.equal(res.status, 401);
  });

  it('valid token → returns my profile and company', async () => {
    const res = await request(app).get('/api/v1/auth/me').set(bearer(owner.token));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.email, owner.email);
    assert.equal(res.body.data.tenant.name, 'Acme Ltd');
  });

  it('tampered token → 401', async () => {
    const parts = owner.token.split('.');
    parts[1] = Buffer.from(JSON.stringify({ sub: owner.user.id, tid: owner.tenant.id, tv: 0, role: 'ADMIN' })).toString('base64url');
    const res = await request(app).get('/api/v1/auth/me').set(bearer(parts.join('.')));
    assert.equal(res.status, 401);
  });

  it('"alg: none" token → 401', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: owner.user.id, ...claims(), iss: 'leadflow-api', aud: 'leadflow-app' })).toString('base64url');
    const res = await request(app).get('/api/v1/auth/me').set(bearer(`${header}.${payload}.`));
    assert.equal(res.status, 401);
  });

  it('token signed with a different secret → 401', async () => {
    const forged = jwt.sign(claims(), 'attacker-secret-attacker-secret-attacker', { ...opts, subject: owner.user.id });
    const res = await request(app).get('/api/v1/auth/me').set(bearer(forged));
    assert.equal(res.status, 401);
  });

  it('expired token → 401', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = jwt.sign({ ...claims(), iat: now - 3600, exp: now - 60 }, process.env.JWT_SECRET, {
      ...opts,
      subject: owner.user.id,
    });
    const res = await request(app).get('/api/v1/auth/me').set(bearer(expired));
    assert.equal(res.status, 401);
  });
});

describe('Refresh token rotation', () => {
  before(startTestDb);
  after(stopTestDb);

  it('refresh gives a NEW token and a NEW cookie', async () => {
    const owner = await registerTenant();
    const res = await refresh(owner.cookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.data.accessToken);
    const newCookie = refreshCookieFrom(res);
    assert.ok(newCookie);
    assert.notEqual(newCookie, owner.cookie);
  });

  it('refresh without cookie → 401', async () => {
    const res = await refresh(null);
    assert.equal(res.status, 401);
  });

  it('CSRF: refresh from an unknown website origin → 403', async () => {
    const owner = await registerTenant();
    assert.equal((await refresh(owner.cookie, 'https://evil.com')).status, 403);
    assert.equal((await refresh(owner.cookie, null)).status, 403);
  });

  it('REUSE DETECTION: using a stolen old token logs out the whole session', async () => {
    const owner = await registerTenant();
    const rotated = await refresh(owner.cookie);
    const newCookie = refreshCookieFrom(rotated);

    // pretend the old token was rotated a minute ago (outside the 5-second double-click grace)
    await RefreshToken.updateOne(
      { tokenHash: hashToken(owner.cookie.split('=')[1]) },
      { $set: { revokedAt: new Date(Date.now() - 60_000) } }
    );

    assert.equal((await refresh(owner.cookie)).status, 401, 'old token must not work');
    assert.equal((await refresh(newCookie)).status, 401, 'whole family must be revoked');
  });

  it('double-click (two refreshes at once) does not log the user out', async () => {
    const owner = await registerTenant();
    const first = await refresh(owner.cookie);
    const second = await refresh(owner.cookie); // same old cookie, within grace
    assert.equal(first.status, 200);
    assert.equal(second.status, 401);
    assert.equal((await refresh(refreshCookieFrom(first))).status, 200, 'newest token still valid');
  });

  it('logout revokes the refresh token', async () => {
    const owner = await registerTenant();
    const out = await request(app).post('/api/v1/auth/logout').set('Origin', ORIGIN).set('Cookie', owner.cookie);
    assert.equal(out.status, 200);
    assert.equal((await refresh(owner.cookie)).status, 401);
  });

  it('password change kicks out old sessions and old access tokens', async () => {
    const owner = await registerTenant();
    const newPassword = 'An0therStrongPass';
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set(bearer(owner.token))
      .send({ currentPassword: owner.password, newPassword });
    assert.equal(res.status, 200);

    assert.equal((await request(app).get('/api/v1/auth/me').set(bearer(owner.token))).status, 401);
    assert.equal((await refresh(owner.cookie)).status, 401);
    assert.equal((await request(app).get('/api/v1/auth/me').set(bearer(res.body.data.accessToken))).status, 200);

    const login = await request(app).post('/api/v1/auth/login').send({ email: owner.email, password: newPassword });
    assert.equal(login.status, 200);
  });

  it('wrong current password → password not changed', async () => {
    const owner = await registerTenant();
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set(bearer(owner.token))
      .send({ currentPassword: 'NotMyPassw0rd', newPassword: 'An0therStrongPass' });
    assert.equal(res.status, 400);
  });

  it('logout-all invalidates current access tokens too', async () => {
    const owner = await registerTenant();
    const res = await request(app).post('/api/v1/auth/logout-all').set(bearer(owner.token));
    assert.equal(res.status, 200);
    assert.equal((await request(app).get('/api/v1/auth/me').set(bearer(owner.token))).status, 401);
  });
});
