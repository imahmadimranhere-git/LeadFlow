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
