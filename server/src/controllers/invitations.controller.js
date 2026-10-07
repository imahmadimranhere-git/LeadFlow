import * as invitationService from '../services/users/invitationService.js';
import { sendSuccess } from '../utils/response.js';
import { setRefreshCookie } from '../utils/authCookies.js';
import { requestMeta } from '../utils/requestMeta.js';

export async function create(req, res) {
  sendSuccess(res, await invitationService.createInvitation(req.auth, req.validated.body), 201);
}

export async function list(_req, res) {
  sendSuccess(res, { items: await invitationService.listInvitations() });
}

export async function revoke(req, res) {
  sendSuccess(res, { invitation: await invitationService.revokeInvitation(req.auth, req.validated.params.id) });
}

export async function accept(req, res) {
  const session = await invitationService.acceptInvitation(req.validated.body, requestMeta(req));
  setRefreshCookie(res, session.refreshToken);
  sendSuccess(res, session.body, 201);
}
