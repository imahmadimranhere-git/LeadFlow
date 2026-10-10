#!/usr/bin/env node
// PHASE 29 — is the production configuration safe?  Shows only key names + advice, never values.
//   On Render (Shell tab, paid plans):   npm run check:prod
//   On your PC with a private file:      npm run check:prod -- --file=..\prod.env   (never commit that file!)
import fs from 'node:fs';
import { checkProductionEnv, parseEnvText } from '../src/config/productionChecks.js';

const fileArg = process.argv.find((a) => a.startsWith('--file='));
const env = fileArg ? parseEnvText(fs.readFileSync(fileArg.slice(7), 'utf8')) : process.env;
const { ok, errors, warnings } = checkProductionEnv(env);
for (const e of errors) process.stdout.write(`❌ ${e.key}: ${e.msg}\n`);
for (const w of warnings) process.stdout.write(`⚠️  ${w.key}: ${w.msg}\n`);
process.stdout.write(ok ? `\n✅ No blocking problems${warnings.length ? ` (${warnings.length} warning(s) above — read them)` : ''}.\n` : `\n❌ ${errors.length} problem(s) must be fixed before going live.\n`);
process.exitCode = ok ? 0 : 1;
