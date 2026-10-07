// Validates ALL environment variables at startup.
// If anything is missing or weak, the server refuses to start (fail securely).
import 'dotenv/config';
import { z } from 'zod';

const PLACEHOLDER = /change_me/i;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  MONGODB_URI: z
    .string()
    .regex(/^mongodb(\+srv)?:\/\//, 'MONGODB_URI must start with mongodb:// or mongodb+srv://'),
  CLIENT_URL: z.string().min(1, 'CLIENT_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug']).default('info'),

  // Auth (all have safe defaults — no need to add them to .env)
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('strict'),

  // Super admin (used only by the seed script)
  SUPER_ADMIN_EMAIL: z.string().trim().toLowerCase().email().optional(),
  ADMIN_TOKEN_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(30),

  // Background jobs (billing cycle...). Set to "false" to switch them off.
  ENABLE_JOBS: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('\n❌ Invalid environment variables (check server/.env):');
  for (const issue of parsed.error.issues) {
    console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const env = parsed.data;

// SameSite=None cookies are only accepted by browsers when Secure=true (HTTPS)
env.COOKIE_SECURE = env.NODE_ENV === 'production' || env.COOKIE_SAMESITE === 'none';

// Extra production-only checks: no placeholder / all-zero secrets in production
if (env.NODE_ENV === 'production') {
  const weak = [];
  if (PLACEHOLDER.test(env.JWT_SECRET)) weak.push('JWT_SECRET');
  if (PLACEHOLDER.test(env.JWT_REFRESH_SECRET)) weak.push('JWT_REFRESH_SECRET');
  if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) weak.push('JWT_SECRET == JWT_REFRESH_SECRET');
  if (/^0+$/.test(env.ENCRYPTION_KEY)) weak.push('ENCRYPTION_KEY');
  if (weak.length) {
    console.error(`\n❌ Weak/placeholder secrets in production: ${weak.join(', ')}`);
    process.exit(1);
  }
}

// CORS allow-list: comma-separated, never "*"
env.CORS_ORIGINS = env.CLIENT_URL.split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (env.CORS_ORIGINS.includes('*')) {
  console.error('\n❌ CLIENT_URL must not contain "*". List exact origins.');
  process.exit(1);
}

export default Object.freeze(env);
