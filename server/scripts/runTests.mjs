#!/usr/bin/env node
// PHASE 28 — one cross-platform test runner (Windows / Mac / Linux, Node 20+).
//   npm test                       → all tests (normal output) + a short, safe-to-share test-report.txt
//   npm run test:pure              → only the fast tests that need no database
//   npm test -- --only=exports,ai  → only test files whose name contains one of these words
//   npm run test:coverage          → all tests + a code-coverage table at the end
// Files run one after another (--test-concurrency=1): each starts its own in-memory MongoDB.
import { spawn } from 'node:child_process'; // security-scan: ignore (developer tool, fixed arguments, no user input)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '..');
const testsDir = path.join(serverDir, 'tests');
const args = process.argv.slice(2);
const pureOnly = args.includes('--pure');
const coverage = args.includes('--coverage');
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const needsDb = (file) => /helpers\/testDb\.js/.test(fs.readFileSync(path.join(testsDir, file), 'utf8'));
let files = fs.readdirSync(testsDir).filter((f) => f.endsWith('.test.js')).sort();
if (pureOnly) files = files.filter((f) => !needsDb(f));
if (only.length) files = files.filter((f) => only.some((o) => f.toLowerCase().includes(o)));
if (!files.length) {
  process.stderr.write('No test files match.\n');
  process.exit(1);
}

const [major] = process.versions.node.split('.').map(Number);
if (major < 20) {
  process.stderr.write(`Node ${process.versions.node} is too old — install Node 20 or newer (nodejs.org, LTS).\n`);
  process.exit(1);
}

const reportFile = path.join(serverDir, 'test-report.txt');
const nodeArgs = [
  '--test',
  '--test-concurrency=1',
  ...(coverage ? ['--experimental-test-coverage'] : []),
  '--test-reporter=spec',
  '--test-reporter-destination=stdout',
  `--test-reporter=${path.join(testsDir, 'helpers', 'failuresReporter.mjs')}`,
  `--test-reporter-destination=${reportFile}`,
  ...files.map((f) => path.join('tests', f)),
];

const started = Date.now();
process.stdout.write(`Running ${files.length} test file(s)${pureOnly ? ' (no database)' : ''}…\n`);
const child = spawn(process.execPath, nodeArgs, { cwd: serverDir, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } });
child.on('exit', (code) => {
  let summary = '';
  try {
    summary = fs.readFileSync(reportFile, 'utf8').split('\n').slice(0, 3).join('\n');
  } catch {
    /* report not written (crash before start) */
  }
  process.stdout.write(`\n────────────────────────────────────────\n${summary}\nTime: ${Math.round((Date.now() - started) / 1000)} s\n`);
  process.stdout.write(code === 0 ? '✅ Done.\n' : `❌ Some tests failed. Short report: ${path.relative(process.cwd(), reportFile) || reportFile}\n   (secrets are masked — you can send this file for help)\n`);
  process.exit(code ?? 1);
});
