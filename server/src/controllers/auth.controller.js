import * as authService from '../services/auth/authService.js';
import * as account from '../services/auth/accountSecurityService.js';
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
  const result = await authService.login(req.validated.body, requestMeta(req));
  if (result.mfaRequired) return sendSuccess(res, { mfaRequired: true, mfaToken: result.mfaToken, expiresIn: result.expiresIn }); // no cookie yet
  return respondWithSession(res, result);
}

export async function loginMfa(req, res) {
  respondWithSession(res, await authService.loginMfa(req.validated.body, requestMeta(req)));
}

// ---- Phase 27: account security
export const forgotPassword = async (req, res) => sendSuccess(res, await account.forgotPassword(req.validated.body, requestMeta(req)));
export const resetPassword = async (req, res) => sendSuccess(res, await account.resetPassword(req.validated.body, requestMeta(req)));
export const verifyEmail = async (req, res) => sendSuccess(res, await account.verifyEmail(req.validated.body, requestMeta(req)));
export const resendVerification = async (req, res) => sendSuccess(res, await account.resendVerification(req.auth, requestMeta(req)));
export const securityStatus = async (req, res) => sendSuccess(res, await account.securityStatus(req.auth));
export const listSessions = async (req, res) => sendSuccess(res, { items: await account.listSessions(req.auth, readRefreshCookie(req)) });
export const revokeSession = async (req, res) => sendSuccess(res, await account.revokeSession(req.auth, req.validated.params.id, requestMeta(req)));
export const mfaSetup = async (req, res) => sendSuccess(res, await account.mfaSetup(req.auth, req.validated.body));
export const mfaEnable = async (req, res) => sendSuccess(res, await account.mfaEnable(req.auth, req.validated.body, requestMeta(req)));
export const mfaDisable = async (req, res) => sendSuccess(res, await account.mfaDisable(req.auth, req.validated.body, requestMeta(req)));
export const mfaRecoveryCodes = async (req, res) => sendSuccess(res, await account.regenerateRecoveryCodes(req.auth, req.validated.body, requestMeta(req)));

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
