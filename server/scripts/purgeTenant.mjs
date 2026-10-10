#!/usr/bin/env node
// PHASE 30 — permanently erase ONE already-deleted company (privacy request).
//   npm run tenant:purge -- --tenant=<id>            → dry run (shows counts)
//   npm run tenant:purge -- --tenant=<id> --apply    → really erase (can't be undone — make a backup first)
// (Same as Super admin → Tenants → company → "Erase data permanently".)
import mongoose from '../src/config/mongoose.js';
import env from '../src/config/env.js';
import '../src/app.js'; // loads every model
import { purgeTenant } from '../src/services/superAdmin/tenantPurgeService.js';

const tenant = process.argv.find((a) => a.startsWith('--tenant='))?.slice(9);
if (!tenant || !mongoose.isValidObjectId(tenant)) {
  process.stderr.write('Usage: npm run tenant:purge -- --tenant=<tenant id> [--apply]\n');
  process.exit(1);
}
await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
const r = await purgeTenant(tenant, { dryRun: !process.argv.includes('--apply') });
process.stdout.write(`${JSON.stringify(r, null, 2)}\n${r.dryRun ? '\nDry run only. Add --apply to erase.\n' : '\n✅ Erased.\n'}`);
await mongoose.disconnect();
process.exit(0);
