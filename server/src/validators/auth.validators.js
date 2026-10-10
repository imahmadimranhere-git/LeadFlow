import { z, email, safeText } from './common.js';

const COMMON_PASSWORDS = new Set([
  'password123', 'password1234', '1234567890', 'qwerty12345', 'iloveyou123',
  'admin12345', 'welcome123', 'pakistan123', 'abc1234567', 'letmein1234',
]);

// bcrypt only uses the first 72 BYTES → we refuse longer passwords instead of silently cutting them
export const strongPassword = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(72, 'Password is too long')
  .refine((p) => Buffer.byteLength(p, 'utf8') <= 72, 'Password is too long')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain letters and numbers')
  .refine((p) => !COMMON_PASSWORDS.has(p.toLowerCase()), 'This password is too common');

export const registerSchema = z
  .object({
    name: safeText(80),
    email,
    password: strongPassword,
    companyName: safeText(120),
  })
  .strict();

export const loginSchema = z
  .object({
    email,
    password: z.string().min(1).max(200),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: strongPassword,
  })
  .strict()
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'New password must be different',
    path: ['newPassword'],
  });

// ---- Phase 27: account security
const linkToken = z.string().regex(/^[A-Za-z0-9_-]{20,200}$/, 'Invalid link');
const totpCode = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');
const recoveryCode = z.string().trim().min(10).max(20);

export const loginMfaSchema = z
  .object({ mfaToken: z.string().min(20).max(2000), code: totpCode.optional(), recoveryCode: recoveryCode.optional() })
  .strict()
  .refine((d) => Boolean(d.code) !== Boolean(d.recoveryCode), { message: 'Enter the 6-digit code OR a recovery code', path: ['code'] });
export const forgotPasswordSchema = z.object({ email }).strict();
export const resetPasswordSchema = z.object({ token: linkToken, newPassword: strongPassword }).strict();
export const verifyEmailSchema = z.object({ token: linkToken }).strict();
export const sessionParams = z.object({ id: z.string().uuid() }).strict();
export const mfaSetupSchema = z.object({ password: z.string().min(1).max(200) }).strict();
export const mfaEnableSchema = z.object({ code: totpCode }).strict();
export const mfaDisableSchema = z
  .object({ password: z.string().min(1).max(200), code: totpCode.optional(), recoveryCode: recoveryCode.optional() })
  .strict()
  .refine((d) => Boolean(d.code) !== Boolean(d.recoveryCode), { message: 'Enter the 6-digit code OR a recovery code', path: ['code'] });
export const mfaRecoverySchema = z.object({ password: z.string().min(1).max(200), code: totpCode }).strict();
