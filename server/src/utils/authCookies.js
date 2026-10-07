// Refresh token cookie: HttpOnly (JavaScript can't read it → XSS can't steal it),
// Secure in production (HTTPS only), SameSite (blocks most CSRF), and limited to /api/v1/auth.
import env from '../config/env.js';

export const REFRESH_COOKIE = 'lf_rt';
const COOKIE_PATH = '/api/v1/auth';

const baseOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAMESITE,
  path: COOKIE_PATH,
});

export function setRefreshCookie(res, rawToken) {
  res.cookie(REFRESH_COOKIE, rawToken, {
    ...baseOptions(),
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, baseOptions());
}

export const readRefreshCookie = (req) => req.cookies?.[REFRESH_COOKIE] || null;
