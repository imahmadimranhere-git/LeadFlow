import { Router } from 'express';
import * as ctrl from '../controllers/users.controller.js';
import validate from '../middleware/validate.js';
import authenticate from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import asyncHandler from '../utils/asyncHandler.js';
import { PERMISSIONS } from '../config/permissions.js';
import { idParams, listUsersQuery, updateRoleBody, updateStatusBody } from '../validators/users.validators.js';

const router = Router();
router.use(authenticate);

router.get('/', authorize(PERMISSIONS.USERS_READ), validate({ query: listUsersQuery }), asyncHandler(ctrl.list));
router.patch('/:id/role', authorize(PERMISSIONS.USERS_MANAGE), validate({ params: idParams, body: updateRoleBody }), asyncHandler(ctrl.updateRole));
router.patch('/:id/status', authorize(PERMISSIONS.USERS_MANAGE), validate({ params: idParams, body: updateStatusBody }), asyncHandler(ctrl.updateStatus));

export default router;
