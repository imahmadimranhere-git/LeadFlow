// PHASE 27 — account security: forgot/reset password (no enumeration, single use, logs out everywhere,
// throttled), email verification, logged-in devices, and two-step login (TOTP + recovery codes, no replay,
// lockout, the ticket can't be used as an access token).
import './helpers/setupEnv.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import Plan from '../src/models/Plan.js';
import User from '../src/models/User.js';
import AuthToken from '../src/models/AuthToken.js';
import { DEFAULT_PLANS } from '../src/config/defaultPlans.js';
import { runAsSystem } from '../src/utils/tenantContext.js';
import { setPlatformMailTransport } from '../src/services/email/platformMailer.js';
import { totpAt, currentStep } from '../src/services/superAdmin/totp.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';
import { ORIGIN, GOOD_PASSWORD, bearer, refreshCookieFrom, registerTenant, inviteAndAccept } from './helpers/authHelpers.js';

const sys = (fn) => runAsSystem('test', fn);
const A = '/api/v1/auth';
const NEW_PASSWORD = 'An0therGoodPassw0rd';

// capture platform emails (never really sent in tests)
const outbox = [];
setPlatformMailTransport(async (mail) => { outbox.push(mail); });
async function waitForMail(to, subjectPart, timeoutMs = 2000) {
  const t0 = Date.now();
  for (;;) {
    const m = outbox.find((x) => x.to === to && x.subject.includes(subjectPart));
    if (m) return m;
    if (Date.now() - t0 > timeoutMs) return null;
    await new Promise((r) => setTimeout(r, 20));
  }
}
const tokenFrom = (mail) => new URL(/https?:\/\/\S+token=[A-Za-z0-9_-]+/.exec(mail.text)[0]).searchParams.get('token');
const login = (email, password, ua) => request(app).post(`${A}/login`).set('User-Agent', ua || 'Mozilla/5.0 (Windows NT 10.0) Chrome/129.0 Safari/537.36').send({ email, password });
const refresh = (cookie) => request(app).post(`${A}/refresh`).set('Origin', ORIGIN).set('Cookie', cookie);

describe('Account security', () => {
  let owner, sales;
  before(async () => {
    await startTestDb();
    await Plan.insertMany(DEFAULT_PLANS);
    owner = await registerTenant();
    sales = await inviteAndAccept(owner, 'SALES');
  });
  after(stopTestDb);

  it('sign-up sends an email confirmation link; it works once; "me" shows confirmed', async () => {
    const mail = await waitForMail(owner.email, 'Confirm your email');
    assert.ok(mail, 'verification email sent');
    assert.ok(!mail.html.includes('<script'), 'html is escaped');
    const token = tokenFrom(mail);
    assert.equal((await request(app).get(`${A}/me`).set(bearer(owner.token))).body.data.user.emailVerified, false);
    assert.equal((await request(app).post(`${A}/verify-email`).send({ token })).status, 200);
    assert.equal((await request(app).post(`${A}/verify-email`).send({ token })).status, 400, 'single use');
    assert.equal((await request(app).get(`${A}/me`).set(bearer(owner.token))).body.data.user.emailVerified, true);
    const again = await request(app).post(`${A}/resend-verification`).set(bearer(owner.token));
    assert.equal(again.body.data.alreadyVerified, true);
    assert.equal((await request(app).post(`${A}/verify-email`).send({ token: 'x'.repeat(40) })).status, 400);
    assert.equal((await request(app).post(`${A}/verify-email`).send({ token: { $ne: null } })).status, 400, 'operator injection');
  });

  it('forgot password: SAME answer for unknown and known emails; only the real account gets a link', async () => {
    const a = await request(app).post(`${A}/forgot-password`).send({ email: 'nobody-here@example.com' });
    const b = await request(app).post(`${A}/forgot-password`).send({ email: sales.email });
    assert.equal(a.status, 200);
    assert.deepEqual(a.body, b.body, 'no account enumeration');
    assert.ok(await waitForMail(sales.email, 'Reset your'));
    assert.ok(!outbox.some((m) => m.to === 'nobody-here@example.com'));
    assert.equal((await request(app).post(`${A}/forgot-password`).send({ email: 'not-an-email' })).status, 400);
  });

  it('reset: works once, old password stops working, every device + old access token logged out, notice email', async () => {
    const otherDevice = await login(sales.email, GOOD_PASSWORD);
    const cookie = refreshCookieFrom(otherDevice);
    outbox.length = 0;
    await request(app).post(`${A}/forgot-password`).send({ email: sales.email });
    const token = tokenFrom(await waitForMail(sales.email, 'Reset your'));
    assert.equal((await request(app).post(`${A}/reset-password`).send({ token, newPassword: 'short' })).status, 400, 'strong password rule');
    const r = await request(app).post(`${A}/reset-password`).send({ token, newPassword: NEW_PASSWORD });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await request(app).post(`${A}/reset-password`).send({ token, newPassword: NEW_PASSWORD })).status, 400, 'single use');
    assert.equal((await login(sales.email, GOOD_PASSWORD)).status, 401);
    assert.equal((await login(sales.email, NEW_PASSWORD)).status, 200);
    assert.equal((await refresh(cookie)).status, 401, 'other devices logged out');
    assert.equal((await request(app).get(`${A}/me`).set(bearer(sales.token))).status, 401, 'old access token dead');
    assert.ok(await waitForMail(sales.email, 'password was changed'));
    const stored = await sys(() => AuthToken.findOne({ purpose: 'PASSWORD_RESET' }).lean());
    assert.notEqual(stored.tokenHash, token, 'only the hash is stored');
  });

  it('reset links: expired → 400; asking again cancels the old link; max 3 links per hour', async () => {
    const x = await registerTenant();
    outbox.length = 0;
    await request(app).post(`${A}/forgot-password`).send({ email: x.email });
    const first = tokenFrom(await waitForMail(x.email, 'Reset your'));
    outbox.length = 0;
    await request(app).post(`${A}/forgot-password`).send({ email: x.email });
    const second = tokenFrom(await waitForMail(x.email, 'Reset your'));
    assert.equal((await request(app).post(`${A}/reset-password`).send({ token: first, newPassword: NEW_PASSWORD })).status, 400, 'older link cancelled');
    await sys(() => AuthToken.updateMany({ userId: x.user.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } }));
    assert.equal((await request(app).post(`${A}/reset-password`).send({ token: second, newPassword: NEW_PASSWORD })).status, 400, 'expired');
    outbox.length = 0;
    await request(app).post(`${A}/forgot-password`).send({ email: x.email }); // 3rd link this hour → sent
    await request(app).post(`${A}/forgot-password`).send({ email: x.email }); // 4th → silently not sent
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(outbox.filter((m) => m.to === x.email && m.subject.includes('Reset')).length, 1);
  });

  it('devices: list with "this device", masked IP, readable name; log one out; can\'t touch other people\'s sessions', async () => {
    const x = await registerTenant();
    const phone = await login(x.email, x.password, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/604.1');
    const phoneCookie = refreshCookieFrom(phone);
    const list = await request(app).get(`${A}/sessions`).set(bearer(x.token)).set('Cookie', x.cookie);
    assert.equal(list.status, 200);
    const items = list.body.data.items;
    assert.equal(items.length, 2);
    assert.equal(items.filter((s) => s.current).length, 1);
    const phoneSession = items.find((s) => s.device === 'Safari on iPhone/iPad');
    assert.ok(phoneSession && !phoneSession.current);
    assert.ok(!JSON.stringify(items).includes('tokenHash'));
    assert.equal((await request(app).delete(`${A}/sessions/${phoneSession.id}`).set(bearer(owner.token))).status, 404, 'someone else\'s session');
    assert.equal((await request(app).delete(`${A}/sessions/not-a-uuid`).set(bearer(x.token))).status, 400);
    assert.equal((await request(app).delete(`${A}/sessions/${phoneSession.id}`).set(bearer(x.token))).status, 200);
    assert.equal((await refresh(phoneCookie)).status, 401, 'that device is logged out');
    assert.equal((await refresh(x.cookie)).status, 200, 'this device still works');
  });

  describe('two-step login (TOTP)', () => {
    let x;
    let secret;
    let recovery;
    before(async () => { x = await registerTenant(); });

    it('set-up needs the password; turning on needs a correct code; gives 10 one-time recovery codes', async () => {
      assert.equal((await request(app).post(`${A}/mfa/setup`).set(bearer(x.token)).send({ password: 'wrong-password-1' })).status, 403);
      const s = await request(app).post(`${A}/mfa/setup`).set(bearer(x.token)).send({ password: x.password });
      assert.equal(s.status, 200);
      secret = s.body.data.secret;
      assert.match(s.body.data.otpauthUrl, /^otpauth:\/\/totp\/LeadFlow/);
      assert.equal((await request(app).post(`${A}/mfa/enable`).set(bearer(x.token)).send({ code: '000000' })).status, 400);
      const on = await request(app).post(`${A}/mfa/enable`).set(bearer(x.token)).send({ code: totpAt(secret, currentStep()) });
      assert.equal(on.status, 200, JSON.stringify(on.body));
      recovery = on.body.data.recoveryCodes;
      assert.equal(recovery.length, 10);
      const db = await sys(() => User.findById(x.user.id).select('+mfaSecretEnc +mfaRecoveryHashes').lean());
      assert.ok(db.mfaSecretEnc.ciphertext && !JSON.stringify(db).includes(secret), 'secret stored encrypted');
      assert.ok(!db.mfaRecoveryHashes.includes(recovery[0]), 'recovery codes stored hashed');
      const st = (await request(app).get(`${A}/security`).set(bearer(x.token))).body.data;
      assert.deepEqual([st.mfaEnabled, st.recoveryCodesLeft], [true, 10]);
      assert.ok(!JSON.stringify((await request(app).get(`${A}/me`).set(bearer(x.token))).body).includes('mfaSecret'));
    });

    it('login: password → ticket (no cookie); code → session; the same code can\'t be used twice', async () => {
      const step1 = await login(x.email, x.password);
      assert.equal(step1.status, 200);
      assert.equal(step1.body.data.mfaRequired, true);
      assert.equal(step1.body.data.accessToken, undefined);
      assert.equal(refreshCookieFrom(step1), null, 'no session before the second step');
      const ticket = step1.body.data.mfaToken;
      assert.equal((await request(app).get(`${A}/me`).set(bearer(ticket))).status, 401, 'ticket is not an access token');
      assert.equal((await request(app).post(`${A}/login/mfa`).send({ mfaToken: `${ticket}x`, code: '123456' })).status, 401, 'tampered ticket');
      const code = totpAt(secret, currentStep() + 1); // the enable step used the current window
      const ok = await request(app).post(`${A}/login/mfa`).send({ mfaToken: ticket, code });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      assert.ok(ok.body.data.accessToken && refreshCookieFrom(ok));
      const again = await request(app).post(`${A}/login/mfa`).send({ mfaToken: (await login(x.email, x.password)).body.data.mfaToken, code });
      assert.equal(again.status, 401, 'replay refused');
    });

    it('recovery code works exactly once and says how many are left; both code + recovery at once → 400', async () => {
      const t = (await login(x.email, x.password)).body.data.mfaToken;
      assert.equal((await request(app).post(`${A}/login/mfa`).send({ mfaToken: t, code: '123456', recoveryCode: recovery[0] })).status, 400);
      const r = await request(app).post(`${A}/login/mfa`).send({ mfaToken: t, recoveryCode: recovery[0].toUpperCase() });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.recoveryCodesLeft, 9);
      const t2 = (await login(x.email, x.password)).body.data.mfaToken;
      assert.equal((await request(app).post(`${A}/login/mfa`).send({ mfaToken: t2, recoveryCode: recovery[0] })).status, 401, 'used code');
    });

    it('turning off needs password + a code', async () => {
      assert.equal((await request(app).post(`${A}/mfa/disable`).set(bearer(x.token)).send({ password: x.password, recoveryCode: 'aaaaa-bbbbb' })).status, 400);
      const off = await request(app).post(`${A}/mfa/disable`).set(bearer(x.token)).send({ password: x.password, recoveryCode: recovery[1] });
      assert.equal(off.status, 200);
      const plain = await login(x.email, x.password);
      assert.ok(plain.body.data.accessToken, 'normal login again');
    });

    it('wrong codes count as failed logins → locked after 5 (password alone can\'t reset the counter)', async () => {
      const y = await registerTenant();
      const s = await request(app).post(`${A}/mfa/setup`).set(bearer(y.token)).send({ password: y.password });
      await request(app).post(`${A}/mfa/enable`).set(bearer(y.token)).send({ code: totpAt(s.body.data.secret, currentStep()) });
      for (let i = 0; i < 5; i += 1) {
        const t = (await login(y.email, y.password)).body.data.mfaToken;
        assert.equal((await request(app).post(`${A}/login/mfa`).send({ mfaToken: t, code: '000000' })).status, 401);
      }
      assert.equal((await login(y.email, y.password)).status, 401, 'locked for 15 minutes');
    });
  });
});
