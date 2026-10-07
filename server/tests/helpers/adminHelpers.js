// Helpers to create a super admin and walk through password + MFA login in tests.
import request from 'supertest';
import app from '../../src/app.js';
import { createPlatformAdmin } from '../../src/services/superAdmin/adminAuthService.js';
import { totpAt, currentStep } from '../../src/services/superAdmin/totp.js';

export const ADMIN_PASSWORD = 'Adm1nStrongPassword';
let n = 0;

export async function createAdmin() {
  const email = `admin.${Date.now()}.${++n}@platform.test`;
  await createPlatformAdmin({ name: 'Test Admin', email, password: ADMIN_PASSWORD });
  return { email, password: ADMIN_PASSWORD, secret: null, lastStep: -1 };
}

/** Full login: password → (setup or verify) MFA → access token. Mutates `admin` (secret, lastStep). */
export async function loginAdmin(admin) {
  const step1 = await request(app).post('/api/v1/super-admin/auth/login').send({ email: admin.email, password: admin.password });
  if (step1.status !== 200) throw new Error(`admin login failed: ${JSON.stringify(step1.body)}`);
  if (step1.body.data.step === 'MFA_SETUP') admin.secret = step1.body.data.secret;

  const step = Math.max(currentStep(), admin.lastStep + 1);
  const code = totpAt(admin.secret, step);
  const step2 = await request(app).post('/api/v1/super-admin/auth/mfa').send({ mfaToken: step1.body.data.mfaToken, code });
  if (step2.status !== 200) throw new Error(`admin MFA failed: ${JSON.stringify(step2.body)}`);
  admin.lastStep = step;
  admin.token = step2.body.data.accessToken;
  return admin;
}

export const adminBearer = (admin) => ({ Authorization: `Bearer ${admin.token}` });
