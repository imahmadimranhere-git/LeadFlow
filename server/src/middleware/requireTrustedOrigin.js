// CSRF protection for endpoints that use the refresh COOKIE (refresh, logout).
// Browsers always send the Origin header on POST; an attacker's site would send its own origin.
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { logSecurityEvent } from '../utils/securityLogger.js';

export default function requireTrustedOrigin(req, _res, next) {
  const origin = req.get('Origin');
  if (origin && env.CORS_ORIGINS.includes(origin)) return next();
  logSecurityEvent('csrf_blocked', { path: req.originalUrl, origin: origin || null, ip: req.ip });
  return next(ApiError.forbidden('Request origin not allowed'));
}
