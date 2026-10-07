import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import env from '../config/env.js';

// 1) Security headers (CSP, HSTS, no-sniff, frame-ancestors, referrer policy...)
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'none'"], // API serves JSON only, no HTML/scripts
      frameAncestors: ["'none'"],
    },
  },
  hsts: env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
  referrerPolicy: { policy: 'no-referrer' },
  crossOriginResourcePolicy: { policy: 'same-site' },
});

// Permissions-Policy is not in helmet — set it manually
export function permissionsPolicy(_req, res, next) {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
}

// 2) CORS strict allow-list — never "*", never reflect arbitrary origins
export const corsMiddleware = cors({
  origin(origin, callback) {
    // Requests without Origin (curl, server-to-server, health checks) are allowed;
    // browsers ALWAYS send Origin on cross-site requests, so they are checked.
    if (!origin) return callback(null, true);
    if (env.CORS_ORIGINS.includes(origin)) return callback(null, true);
    return callback(null, false); // no CORS headers → browser blocks it
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  maxAge: 600,
});

// 3) Global rate limiter (per IP). Stricter per-route limiters come in later phases.
export const globalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).json({
      success: false,
      message: 'Too many requests, please try again later.',
      errors: [],
    }),
});
