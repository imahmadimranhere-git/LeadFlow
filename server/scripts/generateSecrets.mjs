#!/usr/bin/env node
// PHASE 29 — fresh random secrets for PRODUCTION. Run:  npm run secrets:generate
// Copy each line into Render → Environment (and ORIGIN_SECRET also into Vercel → Environment Variables).
// NEVER paste them in chat, email, screenshots or Git. Each run gives NEW values.
import crypto from 'node:crypto';

const lines = [
  ['JWT_SECRET', crypto.randomBytes(48).toString('base64url')],
  ['JWT_REFRESH_SECRET', crypto.randomBytes(48).toString('base64url')],
  ['ENCRYPTION_KEY', crypto.randomBytes(32).toString('hex')],
  ['ORIGIN_SECRET', crypto.randomBytes(32).toString('hex')],
];
process.stdout.write('\n# Production secrets — paste into Render → Environment. Do NOT share or commit.\n');
for (const [k, v] of lines) process.stdout.write(`${k}=${v}\n`);
process.stdout.write('\n# ENCRYPTION_KEY: keep a safe offline copy (password manager). If it is lost, saved integration keys\n# (SMTP passwords, API keys of companies) can no longer be decrypted. To change it later use: npm run rotate-keys\n\n');
