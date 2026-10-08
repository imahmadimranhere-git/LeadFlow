// One-time setup:  npm run seed
//  1) creates the default plans (only if no plans exist yet)
//  2) creates the super admin account (email from SUPER_ADMIN_EMAIL in .env) with a random password
//
// Extra options:
//  npm run seed -- --reset-password   → new random password for the super admin
//  npm run seed -- --reset-mfa        → turn MFA off so you can set it up again (lost phone)
import crypto from 'node:crypto';
import env from '../src/config/env.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import Plan from '../src/models/Plan.js';
import PlatformAdmin from '../src/models/PlatformAdmin.js';
import { DEFAULT_PLANS } from '../src/config/defaultPlans.js';
import IndustryPack from '../src/models/IndustryPack.js';
import { DEFAULT_INDUSTRY_PACKS } from '../src/config/defaultIndustryPacks.js';
import ModelPricing from '../src/models/ModelPricing.js';
import { DEFAULT_MODEL_PRICING } from '../src/config/aiOptions.js';
import { createPlatformAdmin } from '../src/services/superAdmin/adminAuthService.js';
import { hashPassword } from '../src/services/auth/passwordService.js';
import { recordAudit } from '../src/services/audit/auditService.js';

const args = new Set(process.argv.slice(2));

function randomPassword() {
  // 20 chars, letters + digits, always contains both
  const raw = crypto.randomBytes(24).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 18);
  return `${raw}7a`;
}

function box(lines) {
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  console.log(`\n${'='.repeat(width)}`);
  for (const l of lines) console.log(`  ${l}`);
  console.log(`${'='.repeat(width)}\n`);
}

async function seedPlans() {
  const count = await Plan.countDocuments({});
  if (count > 0) {
    console.log(`✔ Plans already exist (${count}) — skipped`);
    return;
  }
  await Plan.insertMany(DEFAULT_PLANS);
  console.log(`✔ Created ${DEFAULT_PLANS.length} default plans`);
}

/** Adds any seed pack whose code doesn't exist yet (never overwrites packs you edited). */
async function seedIndustryPacks() {
  let created = 0;
  for (const pack of DEFAULT_INDUSTRY_PACKS) {
    const exists = await IndustryPack.exists({ code: pack.code });
    if (!exists) {
      await IndustryPack.create(pack);
      created += 1;
    }
  }
  console.log(created ? `✔ Created ${created} industry packs` : '✔ Industry packs already exist — skipped');
}

/** Adds AI models that don't exist yet (never overwrites prices you edited). */
async function seedModelPricing() {
  let created = 0;
  for (const m of DEFAULT_MODEL_PRICING) {
    if (await ModelPricing.exists({ provider: m.provider, modelId: m.modelId })) continue;
    const hasDefault = await ModelPricing.exists({ provider: m.provider, isDefault: true });
    await ModelPricing.create({ ...m, isDefault: m.isDefault && !hasDefault });
    created += 1;
  }
  console.log(created ? `✔ Created ${created} AI models (check prices & model IDs in Super admin → AI models)` : '✔ AI models already exist — skipped');
}

async function seedAdmin() {
  const email = env.SUPER_ADMIN_EMAIL;
  if (!email) {
    console.log('⚠ SUPER_ADMIN_EMAIL is not set in server/.env — super admin not created.');
    return;
  }

  const existing = await PlatformAdmin.findOne({ email });
  if (!existing) {
    const password = randomPassword();
    const admin = await createPlatformAdmin({ name: 'Super Admin', email, password });
    await recordAudit({ actorType: 'SYSTEM', action: 'platform_admin.created', targetType: 'PlatformAdmin', targetId: admin._id });
    box([
      'SUPER ADMIN CREATED',
      `Email:    ${email}`,
      `Password: ${password}`,
      '',
      'Copy this password NOW. It will not be shown again.',
      'Login at: http://localhost:5173/super-admin/login',
      'First login will ask you to set up Google Authenticator (MFA).',
    ]);
    return;
  }

  if (args.has('--reset-password')) {
    const password = randomPassword();
    existing.passwordHash = await hashPassword(password);
    existing.tokenVersion += 1;
    existing.failedLoginCount = 0;
    existing.lockUntil = null;
    await existing.save();
    await recordAudit({ actorType: 'SYSTEM', action: 'platform_admin.password_reset', targetType: 'PlatformAdmin', targetId: existing._id });
    box(['SUPER ADMIN PASSWORD RESET', `Email:    ${email}`, `Password: ${password}`, '', 'Copy it now. It will not be shown again.']);
  }

  if (args.has('--reset-mfa')) {
    await PlatformAdmin.updateOne(
      { _id: existing._id },
      { $set: { mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null, lastTotpStep: -1 }, $inc: { tokenVersion: 1 } }
    );
    await recordAudit({ actorType: 'SYSTEM', action: 'platform_admin.mfa_reset', targetType: 'PlatformAdmin', targetId: existing._id });
    console.log('✔ MFA reset. Next login will ask you to set up the authenticator again.');
  }

  if (!args.has('--reset-password') && !args.has('--reset-mfa')) {
    console.log(`✔ Super admin ${email} already exists — skipped (use --reset-password or --reset-mfa if needed)`);
  }
}

try {
  await connectDB();
  await seedPlans();
  await seedIndustryPacks();
  await seedModelPricing();
  await seedAdmin();
} catch (err) {
  console.error('❌ Seed failed:', err.message);
  process.exitCode = 1;
} finally {
  await disconnectDB();
}
