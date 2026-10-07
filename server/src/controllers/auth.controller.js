import * as authService from '../services/auth/authService.js';
import { sendSuccess } from '../utils/response.js';
import { setRefreshCookie, clearRefreshCookie, readRefreshCookie } from '../utils/authCookies.js';
import { requestMeta } from '../utils/requestMeta.js';

const respondWithSession = (res, session, status = 200) => {
  setRefreshCookie(res, session.refreshToken);
  return sendSuccess(res, session.body, status);
};

export async function register(req, res) {
  const session = await authService.register(req.validated.body, requestMeta(req));
  respondWithSession(res, session, 201);
}

export async function login(req, res) {
  const session = await authService.login(req.validated.body, requestMeta(req));
  respondWithSession(res, session);
}

export async function refresh(req, res) {
  try {
    const session = await authService.refresh(readRefreshCookie(req), requestMeta(req));
    respondWithSession(res, session);
  } catch (err) {
    clearRefreshCookie(res);
    throw err;
  }
}

export async function logout(req, res) {
  await authService.logout(readRefreshCookie(req));
  clearRefreshCookie(res);
  sendSuccess(res, { loggedOut: true });
}

export async function logoutAll(req, res) {
  await authService.logoutAll(req.auth.userId);
  clearRefreshCookie(res);
  sendSuccess(res, { loggedOut: true });
}

export async function me(req, res) {
  sendSuccess(res, await authService.getMe(req.auth.userId));
}

export async function changePassword(req, res) {
  const session = await authService.changePassword(req.auth.userId, req.validated.body, requestMeta(req));
  respondWithSession(res, session);
}
