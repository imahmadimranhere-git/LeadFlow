// PHASE 28 — a custom node:test reporter that writes a SHORT, shareable report (test-report.txt):
// totals, which files failed, and for every failure: the test name, the error, expected vs actual,
// and the line in the test file. Secrets are masked (DB URIs, API keys, tokens, passwords) so the file
// is safe to send for help. Used by `npm test` (scripts/runTests.mjs) next to the normal console output.
import os from 'node:os';

const MAX_VALUE = 700;

/** Masks anything that looks like a secret. Better to over-mask than to leak. */
export function redact(text) {
  return String(text ?? '')
    .replace(/\b(mongodb(?:\+srv)?|postgres(?:ql)?|redis|amqp):\/\/[^:\s/@'"]+:[^@\s'"]+@/gi, '$1://***:***@')
    .replace(/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g, 'sk-***')
    .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, 'AKIA***')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, 'AIza***')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '<jwt>')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1***')
    .replace(/\b(lf_rt=)[^;\s'"]+/g, '$1***')
    .replace(/("?(?:password|passwd|secret|apiKey|api_key|token|accessToken|refreshToken|mfaToken|authorization)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,}]+)/gi, '$1"***"')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, 'C:\\Users\\<you>')
    .replace(/\/home\/[^/\s]+|\/Users\/[^/\s]+/g, '~');
}

const short = (v) => {
  let s;
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v, null, 0);
  } catch {
    s = String(v);
  }
  if (s === undefined) s = String(v);
  return s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE)}… (${s.length} chars)` : s;
};

const rel = (file) => {
  if (!file) return '';
  const f = String(file).replace(/\\/g, '/');
  const i = f.lastIndexOf('/tests/');
  return i >= 0 ? f.slice(i + 1) : f;
};

/** The line inside OUR test/source files where it failed (not node internals). */
function whereFrom(stack) {
  const lines = String(stack || '').split('\n').map((l) => l.replace(/\\/g, '/'));
  const hit = lines.find((l) => /\/(tests|src)\/[^)]*\.m?js:\d+/.test(l) && !/node_modules|node:internal/.test(l));
  if (!hit) return null;
  const m = /((?:tests|src)\/[^):]+:\d+(?::\d+)?)/.exec(hit);
  return m ? m[1] : null;
}

/**
 * Turns collected node:test events into the report text.
 * @param {Array<{type: string, data: any}>} events
 */
export function buildReport(events, { now = new Date(), nodeVersion = process.version, platform = `${os.platform()} ${os.arch()}` } = {}) {
  const stacks = new Map(); // file → [names by nesting]
  const stderr = new Map(); // file → last lines
  const failures = [];
  const perFile = new Map(); // file → { pass, fail }
  let pass = 0;
  let fail = 0;
  let skipped = 0;
  const bump = (file, key) => {
    const r = perFile.get(file) || { pass: 0, fail: 0 };
    r[key] += 1;
    perFile.set(file, r);
  };

  for (const { type, data } of events) {
    const file = rel(data?.file);
    if (type === 'test:start') {
      const s = stacks.get(file) || [];
      s[data.nesting] = data.name;
      s.length = data.nesting + 1;
      stacks.set(file, s);
    } else if (type === 'test:stderr' || type === 'test:stdout') {
      const lines = (stderr.get(file) || []).concat(String(data.message || '').split('\n').filter(Boolean));
      stderr.set(file, lines.slice(-25));
    } else if (type === 'test:pass' || type === 'test:fail') {
      const isSuite = data.details?.type === 'suite';
      if (isSuite && type === 'test:pass') continue;
      const err = data.details?.error;
      if (type === 'test:pass') {
        if (data.skip !== undefined || data.todo !== undefined) skipped += 1;
        else {
          pass += 1;
          bump(file, 'pass');
        }
        continue;
      }
      if (err?.failureType === 'subtestsFailed') continue; // a suite that failed only because a child failed
      fail += 1;
      bump(file, 'fail');
      const cause = err?.cause && typeof err.cause === 'object' ? err.cause : err;
      const s = stacks.get(file) || [];
      const pathNames = [...s.slice(0, data.nesting).filter(Boolean), data.name];
      failures.push({
        file: file || '(unknown file)',
        name: pathNames.join(' › '),
        kind: err?.failureType === 'hookFailed' ? 'before/after hook failed (every test in this block is affected)' : err?.failureType === 'cancelledByParent' ? 'cancelled (an earlier failure stopped it)' : null,
        message: cause?.message || err?.message || 'failed',
        expected: cause && 'expected' in cause ? cause.expected : undefined,
        actual: cause && 'actual' in cause ? cause.actual : undefined,
        code: cause?.code && cause.code !== 'ERR_ASSERTION' ? cause.code : null,
        where: whereFrom(cause?.stack) || whereFrom(err?.stack),
        fileLevel: data.nesting === 0 && /\.m?js$/.test(String(data.name)),
      });
    }
  }

  const out = [];
  out.push('LeadFlow ERP — test report (secrets masked; safe to share)');
  out.push(`Date: ${now.toISOString()} · Node ${nodeVersion} · ${platform}`);
  out.push(`Total: ${pass + fail} tests · PASS ${pass} · FAIL ${fail}${skipped ? ` · skipped ${skipped}` : ''}`);
  out.push('');
  if (!fail) {
    out.push('✅ All tests passed.');
    return redact(out.join('\n'));
  }
  out.push('Files with failures:');
  for (const [f, r] of [...perFile.entries()].filter(([, r]) => r.fail).sort((x, y) => y[1].fail - x[1].fail)) out.push(`  ${f}: ${r.fail} failed, ${r.pass} passed`);
  out.push('');
  out.push('=== FAILURES ===');
  failures.forEach((f, i) => {
    out.push('');
    out.push(`#${i + 1}  ${f.file}`);
    out.push(`    Test:     ${f.name}`);
    if (f.kind) out.push(`    Note:     ${f.kind}`);
    out.push(`    Error:    ${short(f.message).split('\n').filter((l) => l.trim()).slice(0, 14).join('\n              ')}`);
    if (f.code) out.push(`    Code:     ${f.code}`);
    if (f.expected !== undefined || f.actual !== undefined) {
      out.push(`    Expected: ${short(f.expected)}`);
      out.push(`    Actual:   ${short(f.actual)}`);
    }
    if (f.where) out.push(`    Where:    ${f.where}`);
    if (f.fileLevel) {
      const lines = stderr.get(f.file) || [];
      if (lines.length) out.push(`    Output:\n      ${lines.join('\n      ')}`);
    }
  });
  return redact(out.join('\n'));
}

/** node:test reporter entry point. */
export default async function* failuresReporter(source) {
  const keep = new Set(['test:start', 'test:pass', 'test:fail', 'test:stderr', 'test:stdout']);
  const events = [];
  for await (const event of source) if (keep.has(event.type)) events.push({ type: event.type, data: event.data });
  yield `${buildReport(events)}\n`;
}
