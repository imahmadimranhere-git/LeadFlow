#!/usr/bin/env node
// PHASE 27 — LeadFlow static security scan (no packages needed). Run from the repo root or server/:
//   node server/scripts/securityScan.mjs            → prints findings, exit code 1 if any
//   node server/scripts/securityScan.mjs --json     → machine-readable
//   node server/scripts/securityScan.mjs --strict   → a .env file in the folder is also a finding (CI / before sharing)
//
// What it checks (OWASP second pass, spec section 23):
//   SECRET    hard-coded secrets: private keys, OpenAI/Anthropic/AWS/Google/Stripe/GitHub/Slack keys,
//             DB URIs with a password, JWTs, "password = '...'"-style literals, committed .env files
//   CODE      dangerous code: eval / new Function / $where / dangerouslySetInnerHTML / innerHTML=,
//             child_process, Math.random in server code, console.log in server code, CORS "*",
//             jwt.verify without an algorithm list, TLS checks disabled, tokens in localStorage,
//             target=_blank without rel=noopener, raw req.body / req.query in business code
//   ROUTE     every API route has input validation (validate(...)) and authentication, unless it is
//             on the reviewed PUBLIC list below (each with the reason it is safe)
//   MODEL     sensitive model fields (password/secret/token/hash/apiKey) are hidden (private / select:false)
//
// It is a safety net, not proof: it finds known bad patterns; it cannot prove the absence of bugs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ------------------------------------------------------------------ secret patterns
// NOTE: no /i flag on the ALL-CAPS part — otherwise every real password would count as a "placeholder"
const PLACEHOLDER_CAPS = /^(<[^>]*>|\$\{[^}]*\}|[A-Z_]+[0-9]*|x+|\*+|\.\.\.)$/;
const PLACEHOLDER_WORDS = /^(password|changeme|your[-_a-z]*|example[-_a-z]*|test[-_a-z0-9]*|fake[-_a-z0-9]*|dummy[-_a-z0-9]*|replace[-_a-z]*)$/i;
const PLACEHOLDER = { test: (v) => PLACEHOLDER_CAPS.test(v) || PLACEHOLDER_WORDS.test(v) };
export const SECRET_RULES = [
  { id: 'SECRET_PRIVATE_KEY', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: 'SECRET_OPENAI_KEY', re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/ },
  { id: 'SECRET_ANTHROPIC_KEY', re: /\bsk-ant-(?:api\d\d-)?[A-Za-z0-9_-]{40,}/ },
  { id: 'SECRET_AWS_KEY', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'SECRET_GOOGLE_KEY', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'SECRET_STRIPE_KEY', re: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/ },
  { id: 'SECRET_GITHUB_TOKEN', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}/ },
  { id: 'SECRET_SLACK_TOKEN', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { id: 'SECRET_JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { id: 'SECRET_META_TOKEN', re: /\bEAA[A-Za-z0-9]{100,}/ },
  {
    id: 'SECRET_DB_URI_PASSWORD',
    re: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp):\/\/([^:/\s'"`@]+):([^@\s'"`]+)@/,
    ok: (m) => PLACEHOLDER.test(m[2]),
  },
  {
    id: 'SECRET_ASSIGNED_LITERAL',
    re: /\b(?:secret|passwd|password|api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key)\b["']?\s*[:=]\s*["']([^"'\s]{12,})["']/i,
    ok: (m) => PLACEHOLDER.test(m[1]) || /^(process\.env|env\.)/.test(m[1]),
    skipTests: true, // test files deliberately contain fake passwords
  },
];

// ------------------------------------------------------------------ dangerous code patterns
export const CODE_RULES = [
  { id: 'CODE_EVAL', re: /(?<![\w.])eval\s*\(|new\s+Function\s*\(/, where: 'all' },
  { id: 'CODE_MONGO_WHERE', re: /['"]?\$where['"]?\s*:/, where: 'all' },
  { id: 'CODE_DANGEROUS_HTML', re: /dangerouslySetInnerHTML/, where: 'all' },
  { id: 'CODE_INNER_HTML', re: /\.(?:innerHTML|outerHTML)\s*=(?!=)|insertAdjacentHTML\s*\(|document\.write\s*\(/, where: 'all' },
  { id: 'CODE_CHILD_PROCESS', re: /['"](?:node:)?child_process['"]/, where: 'server' },
  { id: 'CODE_WEAK_RANDOM', re: /Math\.random\s*\(/, where: 'server' },
  { id: 'CODE_CONSOLE_LOG', re: /\bconsole\.(?:log|debug|info)\s*\(/, where: 'server' },
  { id: 'CODE_CORS_WILDCARD', re: /origin\s*:\s*['"]\*['"]|Access-Control-Allow-Origin['"]?\s*,\s*['"]\*['"]/, where: 'all' },
  { id: 'CODE_JWT_NO_ALGORITHMS', re: /jwt\.verify\s*\((?![^\n]*algorithms)/, where: 'server' },
  { id: 'CODE_TLS_DISABLED', re: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/, where: 'all' },
  { id: 'CODE_TOKEN_IN_LOCALSTORAGE', re: /localStorage\.setItem\(\s*['"`][^'"`]*(?:token|secret|password)/i, where: 'client' },
  { id: 'CODE_BLANK_NO_NOOPENER', re: /target=["']_blank["'](?![^>]*rel=["'][^"']*noopener)/, where: 'client' },
  // business code must use req.validated (checked by Zod), never the raw request
  { id: 'CODE_RAW_REQUEST_INPUT', re: /\breq\.(?:body|query)\b/, where: 'server-business' },
];

// Lines that are reviewed and fine (file suffix + rule + a snippet of the line) — keep this list SHORT.
export const REVIEWED = [
  // webhooks read the RAW body on purpose: the signature is computed over the exact bytes
  { file: 'src/routes/webhooks.routes.js', rule: 'CODE_RAW_REQUEST_INPUT', why: 'raw body needed for HMAC signature check; parsed + validated inside the service' },
  // Meta OAuth callback validates req.query with a strict Zod schema on the line itself
  { file: 'src/routes/integrations.routes.js', rule: 'CODE_RAW_REQUEST_INPUT', snippet: 'oauthCallbackQuery.safeParse(req.query', why: 'validated with Zod on the same line' },
  // binary uploads: the body is a Buffer from express.raw (size + type limited); content checked by magic bytes / CSV parser
  { file: 'src/routes/imports.routes.js', rule: 'CODE_RAW_REQUEST_INPUT', snippet: 'buffer: req.body', why: 'CSV upload buffer (express.raw, size-limited, parsed + validated row by row)' },
  { file: 'src/controllers/settings.controller.js', rule: 'CODE_RAW_REQUEST_INPUT', snippet: 'buffer: req.body', why: 'logo upload buffer (256 KB, magic-byte check, SVG refused)' },
];

// Authenticated routes that validate in another way than validate(...) — reviewed.
export const OTHER_VALIDATION = [
  { file: 'imports.routes.js', method: 'post', path: '/', why: 'raw CSV upload: content type + size limit, every row validated by the import parser' },
  { file: 'settings.routes.js', method: 'put', path: '/branding/logo', why: 'raw image upload: type allow-list, 256 KB, magic bytes' },
  { file: 'integrations.routes.js', method: 'put', path: '/:provider', marker: 'validateSaveBody', why: 'per-provider strict Zod schema (validateSaveBody)' },
];

// ------------------------------------------------------------------ public routes (reviewed)
// Every route NOT listed here must have authentication. Each entry says why it is safe without login.
export const PUBLIC_ROUTES = [
  { file: 'superAdmin.routes.js', method: 'post', path: '/auth/login', why: 'super admin login step 1; strict rate limit, generic error' },
  { file: 'superAdmin.routes.js', method: 'post', path: '/auth/mfa', why: 'super admin login step 2 (TOTP, mandatory)' },
  { file: 'auth.routes.js', method: 'post', path: '/register', why: 'sign-up; rate limited, strict schema' },
  { file: 'auth.routes.js', method: 'post', path: '/login', why: 'login; rate limited, lockout, generic error' },
  { file: 'auth.routes.js', method: 'post', path: '/login/mfa', why: 'second login step; needs the 5-minute MFA ticket from /login' },
  { file: 'auth.routes.js', method: 'post', path: '/refresh', why: 'HttpOnly refresh cookie + trusted Origin (CSRF) + rotation/reuse detection' },
  { file: 'auth.routes.js', method: 'post', path: '/logout', why: 'refresh cookie + trusted Origin' },
  { file: 'auth.routes.js', method: 'post', path: '/forgot-password', why: 'always the same answer (no account enumeration); rate limited per IP and per email' },
  { file: 'auth.routes.js', method: 'post', path: '/reset-password', why: 'single-use, hashed, 30-minute token' },
  { file: 'auth.routes.js', method: 'post', path: '/verify-email', why: 'single-use, hashed token' },
  { file: 'invitations.routes.js', method: 'post', path: '/accept', why: 'single-use hashed invitation token' },
  { file: 'extension.routes.js', method: 'post', path: '/pair', why: 'one-time pairing code (short-lived, hashed, rate limited)' },
  { file: 'extension.routes.js', method: 'post', path: '/token', why: 'extension refresh credential, rate limited' },
  { file: 'exports.routes.js', method: 'get', path: '/download/:token', why: 'HMAC-signed 10-minute link; user + permission re-checked' },
  { file: 'health.routes.js', method: 'get', path: '/', why: 'health check, returns no data', noValidate: true },
  { file: 'unsubscribe.routes.js', method: 'get', path: '/:token', why: 'HMAC-signed unsubscribe token, verified before anything else; query string dropped', noValidate: true },
  { file: 'unsubscribe.routes.js', method: 'post', path: '/:token', why: 'HMAC-signed unsubscribe token; the one-click body is ignored', noValidate: true },
  { file: 'webhooks.routes.js', method: 'post', path: '/payments/:provider', why: 'signature over raw body, replay protection', noValidate: true },
  { file: 'webhooks.routes.js', method: 'post', path: '/leads/:publicKey', why: 'per-webhook secret/HMAC, rate limited', noValidate: true },
  { file: 'webhooks.routes.js', method: 'get', path: '/whatsapp', why: 'Meta verify-token handshake', noValidate: true },
  { file: 'webhooks.routes.js', method: 'post', path: '/whatsapp', why: 'X-Hub-Signature-256 over raw body', noValidate: true },
  { file: 'integrations.routes.js', method: 'get', path: '/', router: 'metaCallbackRouter', why: 'OAuth redirect; single-use hashed state; Zod-validated query', noValidate: true },
];
const AUTH_MARKERS = /\b(authenticate|authenticateAllowBillingOnly|superAdminAuth|authenticateExtension)\b|\.\.\.ext\b/;

// ------------------------------------------------------------------ helpers
const isTest = (rel) => /(^|\/)tests?\//.test(rel) || /\.test\.m?jsx?$/.test(rel);
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

/** Text of a call starting at `open` (index of "("), skipping strings/template literals/comments. */
export function callText(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      for (i += 1; i < src.length && src[i] !== q; i += 1) if (src[i] === '\\') i += 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) return src.slice(open, i + 1); }
  }
  return src.slice(open);
}

export function scanSecrets(text, rel) {
  const out = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (/secret-scan:\s*ignore/.test(line)) return;
    for (const r of SECRET_RULES) {
      if (r.skipTests && isTest(rel)) continue;
      const m = r.re.exec(line);
      if (m && !(r.ok && r.ok(m))) out.push({ rule: r.id, file: rel, line: i + 1, text: line.trim().slice(0, 140).replace(m[0], `${m[0].slice(0, 6)}…[redacted]`) });
    }
  });
  return out;
}

function areaOf(rel) {
  if (rel.startsWith('client/')) return 'client';
  if (rel.startsWith('extension/')) return 'client';
  if (rel.startsWith('server/src/')) return 'server';
  return 'other';
}

export function scanCode(text, rel) {
  const out = [];
  if (isTest(rel) || rel.includes('/scripts/')) return out;
  const area = areaOf(rel);
  const business = area === 'server' && !/server\/src\/(middleware|config|validators)\//.test(rel);
  text.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\/?\*)/.test(line) || /security-scan:\s*ignore/.test(line)) return; // comments + explicit, reviewed opt-outs
    for (const r of CODE_RULES) {
      const applies = r.where === 'all' ? area !== 'other' : r.where === 'server-business' ? business : r.where === area;
      if (!applies || !r.re.test(line)) continue;
      const reviewed = REVIEWED.some((x) => rel.endsWith(x.file) && x.rule === r.id && (!x.snippet || line.includes(x.snippet)));
      if (!reviewed) out.push({ rule: r.id, file: rel, line: i + 1, text: line.trim().slice(0, 160) });
    }
  });
  return out;
}

/** Every route: validate(...) present; authenticated (router.use before it, or inline) unless reviewed-public. */
export function scanRoutes(text, rel) {
  const out = [];
  const file = path.basename(rel);
  const uses = []; // { router, idx, auth }
  for (const m of text.matchAll(/\b(\w+)\.use\(/g)) {
    const body = callText(text, m.index + m[0].length - 1);
    uses.push({ router: m[1], idx: m.index, auth: AUTH_MARKERS.test(body) });
  }
  for (const m of text.matchAll(/\b(\w+)\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]*)\3/g)) {
    const [, router, method, , routePath] = m;
    if (!/router$/i.test(router)) continue;
    const call = callText(text, m.index + m[0].indexOf('('));
    const pub = PUBLIC_ROUTES.find((p) => p.file === file && p.method === method && p.path === routePath && (!p.router || p.router === router));
    const authed = AUTH_MARKERS.test(call) || uses.some((u) => u.router === router && u.idx < m.index && u.auth);
    const line = lineOf(text, m.index);
    if (!authed && !pub) out.push({ rule: 'ROUTE_NO_AUTH', file: rel, line, text: `${method.toUpperCase()} ${routePath} (${router})` });
    const other = OTHER_VALIDATION.find((p) => p.file === file && p.method === method && p.path === routePath && (!p.marker || call.includes(p.marker)));
    if (!/\bvalidate\s*\(/.test(call) && !pub?.noValidate && !other) out.push({ rule: 'ROUTE_NO_VALIDATION', file: rel, line, text: `${method.toUpperCase()} ${routePath} (${router})` });
    if (authed && pub) out.push({ rule: 'ROUTE_PUBLIC_LIST_STALE', file: rel, line, text: `${method.toUpperCase()} ${routePath} is authenticated — remove it from PUBLIC_ROUTES` });
  }
  return out;
}

/** Sensitive schema fields must be hidden from JSON (private: true) or from queries (select: false). */
export function scanModels(text, rel) {
  const out = [];
  const SENSITIVE = /^(?:\w*(?:password|passwd|secret|apiKey|privateKey)\w*|\w*(?:token|Token)(?:Hash)?|\w*Hash|mfaSecret\w*|recoveryCodes?)$/;
  const SAFE_NAMES = /^(?:tokenVersion|tokenCount|maxOutputTokens|inputTokens|outputTokens|totalTokens|aiTokens\w*|tokensUsed|tokenType)$/;
  text.split('\n').forEach((line, i) => {
    const m = /^\s*['"]?(\w+)['"]?\s*:\s*\{\s*type\s*:/.exec(line);
    if (!m || !SENSITIVE.test(m[1]) || SAFE_NAMES.test(m[1])) return;
    if (/private\s*:\s*true|select\s*:\s*false/.test(line)) return;
    out.push({ rule: 'MODEL_SENSITIVE_FIELD_VISIBLE', file: rel, line: i + 1, text: line.trim().slice(0, 160) });
  });
  return out;
}

// ------------------------------------------------------------------ runner
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.husky']);
function walk(dir, root, files = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, root, files);
    else files.push(path.relative(root, p).split(path.sep).join('/'));
  }
  return files;
}

/**
 * @param {string} root
 * @param {{ envFiles?: 'report' | 'note' }} opts  'report' (CI / before sharing a zip) = a .env file is a finding;
 *        'note' (your own PC) = it is only listed as a reminder — server/.env is normal locally and is in .gitignore.
 */
export function scanRepo(root, { envFiles = 'note' } = {}) {
  const findings = [];
  const notes = [];
  for (const rel of walk(root, root)) {
    if (/(^|\/)\.env(\.|$)/.test(rel) && !rel.endsWith('.env.example')) {
      if (envFiles === 'report') findings.push({ rule: 'SECRET_ENV_FILE', file: rel, line: 0, text: '.env file in the folder — must never be committed, zipped or shared' });
      else notes.push(`${rel} exists — fine on your own computer (it is in .gitignore), but never commit, zip or share it.`);
      continue;
    }
    if (!/\.(m?js|jsx|json|md|ya?ml|html|example|txt)$/.test(rel) || rel.endsWith('package-lock.json')) continue;
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    if (rel.endsWith('server/scripts/securityScan.mjs') || rel.endsWith('tests/securityCore.test.js')) continue; // contains the patterns themselves
    findings.push(...scanSecrets(text, rel));
    if (/\.(m?js|jsx)$/.test(rel)) findings.push(...scanCode(text, rel));
    if (/server\/src\/routes\/[^/]+\.routes\.js$/.test(rel)) findings.push(...scanRoutes(text, rel));
    if (/server\/src\/models\/[^/]+\.js$/.test(rel)) findings.push(...scanModels(text, rel));
  }
  findings.notes = notes;
  return findings;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, '..', '..'); // repo root (leadflow-erp)
  const findings = scanRepo(root, { envFiles: process.argv.includes('--strict') ? 'report' : 'note' });
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`);
  } else {
    for (const n of findings.notes) process.stdout.write(`ℹ ${n}\n`);
    for (const f of findings) process.stdout.write(`${f.rule.padEnd(30)} ${f.file}:${f.line}  ${f.text}\n`);
    process.stdout.write(findings.length ? `\n❌ ${findings.length} finding(s). Fix them, or (only after review) add a reasoned exception.\n` : '✅ Security scan: no findings.\n');
  }
  process.exitCode = findings.length ? 1 : 0;
}
