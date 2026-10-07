import * as userService from '../services/users/userService.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';

export async function list(req, res) {
  const q = req.validated.query;
  const { items, total } = await userService.listUsers(q);
  sendPaginated(res, items, { page: q.page, limit: q.limit, total });
}

export async function updateRole(req, res) {
  const user = await userService.updateUserRole(req.auth, req.validated.params.id, req.validated.body.role);
  sendSuccess(res, { user });
}

export async function updateStatus(req, res) {
  const user = await userService.updateUserStatus(req.auth, req.validated.params.id, req.validated.body.status);
  sendSuccess(res, { user });
}
