// Stricter limits for sensitive endpoints (on top of the global limiter).
import rateLimit from 'express-rate-limit';
import env from '../config/env.js';

const handler = (_req, res) =>
  res.status(429).json({ success: false, message: 'Too many attempts, please try again later.', errors: [] });

const make = (windowMs, limit) =>
  rateLimit({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, handler });

// login / register / accept-invite: per IP, 15 minutes
export const authLimiter = make(15 * 60 * 1000, env.AUTH_RATE_LIMIT_MAX);
// refresh is called often by the app → more generous
export const refreshLimiter = make(15 * 60 * 1000, env.AUTH_RATE_LIMIT_MAX * 4);
// creating invitations
export const inviteLimiter = make(60 * 60 * 1000, env.AUTH_RATE_LIMIT_MAX);
