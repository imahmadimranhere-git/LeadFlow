// PHASE 27 — pure security tests (no database): the static security scanner (it must catch real bad
// patterns AND the whole project must be clean), recovery codes, IP masking, device names, TOTP replay.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSecrets, scanCode, scanRoutes, scanModels, scanRepo } from '../scripts/securityScan.mjs';
import { generateRecoveryCodes, normalizeRecoveryCode, hashSecret, maskIp, describeUserAgent } from '../src/services/auth/authCodes.js';
import { generateTotpSecret, totpAt, currentStep, verifyTotp } from '../src/services/superAdmin/totp.js';

const rules = (list) => list.map((f) => f.rule);
// fake secrets are built from pieces so this file itself never contains a real-looking key
const fakeOpenAi = ['sk', 'proj', 'A'.repeat(40)].join('-');
const fakeAws = `AKIA${'Z'.repeat(16)}`;

describe('Security scanner — secrets', () => {
  it('finds real-looking keys, DB passwords and private keys; ignores placeholders and env lookups', () => {
    assert.deepEqual(rules(scanSecrets(`const k = '${fakeOpenAi}';`, 'server/src/x.js')), ['SECRET_OPENAI_KEY']);
    assert.deepEqual(rules(scanSecrets(`aws = "${fakeAws}"`, 'server/src/x.js')), ['SECRET_AWS_KEY']);
    assert.deepEqual(rules(scanSecrets('MONGODB_URI=mongodb+srv://admin:Hunter2Pass@cluster0.x.mongodb.net/db', 'server/.env.example')), ['SECRET_DB_URI_PASSWORD']);
    assert.deepEqual(scanSecrets('MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.x.mongodb.net/db', 'server/.env.example'), [], 'placeholder');
    assert.deepEqual(scanSecrets('MONGODB_URI=mongodb+srv://user:<password>@cluster0.x.mongodb.net/db', 'README.md'), [], 'placeholder');
    assert.deepEqual(rules(scanSecrets(['-----BEGIN', 'PRIVATE KEY-----'].join(' '), 'a.md')), ['SECRET_PRIVATE_KEY']);
    assert.deepEqual(rules(scanSecrets("const password = 'Sup3rSecretValue!';", 'server/src/a.js')), ['SECRET_ASSIGNED_LITERAL']);
    assert.deepEqual(scanSecrets("const password = 'Sup3rSecretValue!';", 'server/tests/a.test.js'), [], 'tests may contain fake passwords');
    assert.deepEqual(scanSecrets(`const k = '${fakeOpenAi}'; // secret-scan: ignore (fake)`, 'server/src/x.js'), [], 'explicit reviewed opt-out');
    const f = scanSecrets(`const k = '${fakeOpenAi}';`, 'server/src/x.js')[0];
    assert.ok(!f.text.includes(fakeOpenAi), 'the report never prints the full secret');
  });
});

describe('Security scanner — dangerous code', () => {
  it('flags eval, $where, raw HTML, weak random, console.log, CORS *, TLS off, tokens in localStorage, raw req.body', () => {
    const c = (line, file = 'server/src/services/x.js') => rules(scanCode(line, file));
    assert.deepEqual(c('eval(userInput)'), ['CODE_EVAL']);
    assert.deepEqual(c("Lead.find({ $where: 'this.a' })"), ['CODE_MONGO_WHERE']);
    assert.deepEqual(c('<div dangerouslySetInnerHTML={{ __html: x }} />', 'client/src/a.jsx'), ['CODE_DANGEROUS_HTML']);
    assert.deepEqual(c('el.innerHTML = caption', 'extension/popup.js'), ['CODE_INNER_HTML']);
    assert.deepEqual(c('const t = Math.random().toString(36)'), ['CODE_WEAK_RANDOM']);
    assert.deepEqual(c('console.log(user)'), ['CODE_CONSOLE_LOG']);
    assert.deepEqual(c("cors({ origin: '*' })"), ['CODE_CORS_WILDCARD']);
    assert.deepEqual(c('jwt.verify(token, secret)'), ['CODE_JWT_NO_ALGORITHMS']);
    assert.deepEqual(c("jwt.verify(token, secret, { algorithms: ['HS256'] })"), []);
    assert.deepEqual(c('tls: { rejectUnauthorized: false }'), ['CODE_TLS_DISABLED']);
    assert.deepEqual(c("localStorage.setItem('accessToken', t)", 'client/src/a.js'), ['CODE_TOKEN_IN_LOCALSTORAGE']);
    assert.deepEqual(c('<a href={u} target="_blank">x</a>', 'client/src/a.jsx'), ['CODE_BLANK_NO_NOOPENER']);
    assert.deepEqual(c('<a href={u} target="_blank" rel="noopener noreferrer">x</a>', 'client/src/a.jsx'), []);
    assert.deepEqual(c('await Lead.create(req.body)'), ['CODE_RAW_REQUEST_INPUT']);
    assert.deepEqual(c('const x = req.body', 'server/src/middleware/validate.js'), [], 'middleware is where raw input is checked');
    assert.deepEqual(c('// eval( is bad'), [], 'comments ignored');
    assert.deepEqual(c('eval(x)', 'server/tests/a.test.js'), [], 'tests ignored');
  });
});

describe('Security scanner — routes and models', () => {
  it('a route without validate() or without login is reported; router.use(authenticate) covers later routes only', () => {
    const src = [
      "router.get('/open', validate({}), h(x));",
      'router.use(authenticate);',
      "router.get('/a', validate({}), h(x));",
      "router.post('/b', h(x));",
    ].join('\n');
    const f = scanRoutes(src, 'server/src/routes/demo.routes.js');
    assert.deepEqual(f.map((x) => [x.rule, x.line]), [['ROUTE_NO_AUTH', 1], ['ROUTE_NO_VALIDATION', 4]]);
    assert.deepEqual(scanRoutes("router.post('/login', authLimiter, validate({ body: s }), h(x));", 'server/src/routes/auth.routes.js'), [], 'reviewed public route');
    assert.deepEqual(rules(scanRoutes("router.post('/x', authenticate, h(x));", 'server/src/routes/demo.routes.js')), ['ROUTE_NO_VALIDATION']);
  });

  it('sensitive model fields must be hidden', () => {
    assert.deepEqual(rules(scanModels('    resetTokenHash: { type: String, required: true },', 'server/src/models/X.js')), ['MODEL_SENSITIVE_FIELD_VISIBLE']);
    assert.deepEqual(scanModels('    tokenHash: { type: String, required: true, private: true },', 'server/src/models/X.js'), []);
    assert.deepEqual(scanModels('    passwordHash: { type: String, select: false, private: true },', 'server/src/models/X.js'), []);
    assert.deepEqual(scanModels('    totalTokens: { type: Number, default: 0 },', 'server/src/models/X.js'), [], 'token COUNTS are not secrets');
  });

  it('THE WHOLE PROJECT is clean (no secrets, no dangerous code, every route validated + protected)', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const findings = scanRepo(root, { envFiles: 'note' });
    assert.deepEqual(findings.map((f) => `${f.rule} ${f.file}:${f.line} ${f.text}`), []);
  });
});

describe('Account security helpers', () => {
  it('recovery codes: 10 unique "xxxxx-xxxxx" codes; typing variations accepted; garbage refused', () => {
    const codes = generateRecoveryCodes();
    assert.equal(codes.length, 10);
    assert.equal(new Set(codes).size, 10);
    for (const c of codes) assert.match(c, /^[a-z2-7]{5}-[a-z2-7]{5}$/);
    const [first] = codes;
    assert.equal(normalizeRecoveryCode(first.toUpperCase().replace('-', ' ')), first.replace('-', ''));
    assert.equal(normalizeRecoveryCode('short'), null);
    assert.equal(normalizeRecoveryCode({ $ne: null }), null);
    assert.equal(hashSecret('a').length, 64);
  });

  it('IP addresses are masked; device names are readable', () => {
    assert.equal(maskIp('203.0.113.45'), '203.0.113.x');
    assert.equal(maskIp('::ffff:10.1.2.3'), '10.1.2.x');
    assert.equal(maskIp('2001:db8:85a3:0:0:8a2e:370:7334'), '2001:db8:85a3:…');
    assert.equal(maskIp(null), null);
    assert.equal(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'), 'Chrome on Windows');
    assert.equal(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'), 'Safari on iPhone/iPad');
    assert.equal(describeUserAgent('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0'), 'Edge on Windows');
    assert.equal(describeUserAgent(''), 'Unknown device');
  });

  it('TOTP: the right code works once; the same code can\'t be replayed; old codes fail', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const step = currentStep(now);
    const code = totpAt(secret, step);
    assert.equal(verifyTotp(secret, code, { nowMs: now }), step);
    assert.equal(verifyTotp(secret, code, { nowMs: now, lastUsedStep: step }), null, 'replay refused');
    assert.equal(verifyTotp(secret, totpAt(secret, step - 5), { nowMs: now }), null, '2.5 minutes old');
    assert.equal(verifyTotp(secret, '12345', { nowMs: now }), null);
  });
});
