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

// 2) CORS strict allow-list — never "*", never reflect arbitrary origins.
//    The Chrome extension's origin is accepted ONLY on /api/v1/extension/* and without cookies.
const EXTENSION_PATH = /^\/api\/v1\/extension(\/|$)/;
export function isAllowedExtensionOrigin(origin) {
  if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin || '')) return false;
  if (env.EXTENSION_ORIGINS.length) return env.EXTENSION_ORIGINS.includes(origin);
  return env.NODE_ENV !== 'production'; // dev convenience; production needs the exact ID
}

const baseCors = {
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-File-Name'],
  maxAge: 600,
};

export const corsMiddleware = cors((req, callback) => {
  const origin = req.get('Origin');
  // Requests without Origin (curl, server-to-server, health checks) are allowed;
  // browsers ALWAYS send Origin on cross-site requests, so they are checked.
  if (!origin) return callback(null, { ...baseCors, origin: true, credentials: true });
  if (env.CORS_ORIGINS.includes(origin)) return callback(null, { ...baseCors, origin: true, credentials: true });
  if (EXTENSION_PATH.test(req.originalUrl || req.url) && isAllowedExtensionOrigin(origin)) {
    return callback(null, { ...baseCors, origin: true, credentials: false }); // Bearer token only, never cookies
  }
  return callback(null, { ...baseCors, origin: false }); // no CORS headers → browser blocks it
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
