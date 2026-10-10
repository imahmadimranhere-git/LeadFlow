// PHASE 28 — the test tools themselves: the shareable report must mask secrets and point at the right line.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redact, buildReport } from './helpers/failuresReporter.mjs';

describe('Test report', () => {
  it('masks secrets: DB passwords, API keys, JWTs, bearer tokens, cookies, password fields, user folders', () => {
    const jwtLike = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjMifQ', 'abcdefghijk'].join('.');
    const uri = ['mongodb+srv://admin', 'Hunter2@x.mongodb.net/db'].join(':'); // built from parts: no real-looking secret in this file
    const s = redact(`${uri} sk-${'a'.repeat(30)} ${jwtLike} Bearer abcdefghijklmnop lf_rt=xyz123 {"password":"Str0ngPass"} C:\\Users\\hp\\LeadFlow`);
    for (const secret of ['Hunter2', 'a'.repeat(30), jwtLike, 'abcdefghijklmnop', 'xyz123', 'Str0ngPass', '\\hp\\']) assert.ok(!s.includes(secret), secret);
    assert.match(s, /mongodb\+srv:\/\/\*\*\*:\*\*\*@x\.mongodb\.net/);
  });

  it('report: totals, failing files, full test name, expected/actual, location; hooks and crashes explained', () => {
    const f = 'C:\\Users\\hp\\LeadFlow\\server\\tests\\exports.test.js';
    const assertion = Object.assign(new Error('Expected 202, got 409'), { actual: 409, expected: 202, code: 'ERR_ASSERTION', stack: `AssertionError\n    at TestContext.<anonymous> (file:///C:/Users/hp/LeadFlow/server/tests/exports.test.js:120:12)\n    at node:internal/x` });
    const events = [
      { type: 'test:start', data: { file: f, nesting: 0, name: 'Exports' } },
      { type: 'test:start', data: { file: f, nesting: 1, name: 'creates a job' } },
      { type: 'test:fail', data: { file: f, nesting: 1, name: 'creates a job', details: { error: { failureType: 'testCodeFailure', cause: assertion } } } },
      { type: 'test:start', data: { file: f, nesting: 1, name: 'lists jobs' } },
      { type: 'test:pass', data: { file: f, nesting: 1, name: 'lists jobs', details: {} } },
      { type: 'test:fail', data: { file: f, nesting: 0, name: 'Exports', details: { type: 'suite', error: { failureType: 'subtestsFailed' } } } },
      { type: 'test:fail', data: { file: f, nesting: 0, name: 'DB', details: { type: 'suite', error: { failureType: 'hookFailed', cause: new Error('MongoMemoryServer download failed') } } } },
    ];
    const r = buildReport(events, { now: new Date('2026-10-10T00:00:00Z'), nodeVersion: 'v22', platform: 'win32 x64' });
    assert.match(r, /Total: 3 tests · PASS 1 · FAIL 2/);
    assert.match(r, /tests\/exports\.test\.js: 2 failed, 1 passed/);
    assert.match(r, /Test:\s+Exports › creates a job/);
    assert.match(r, /Expected: 202\n\s+Actual:\s+409/);
    assert.match(r, /Where:\s+tests\/exports\.test\.js:120:12/);
    assert.match(r, /before\/after hook failed/);
    assert.ok(!r.includes('\\hp\\') && !r.includes('/hp/'), 'no personal folder names');
    assert.equal(buildReport([{ type: 'test:pass', data: { file: f, nesting: 0, name: 'x', details: {} } }]).includes('All tests passed'), true);
  });
});
