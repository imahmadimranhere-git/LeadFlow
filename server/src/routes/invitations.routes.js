import { Router } from 'express';
import * as ctrl from '../controllers/invitations.controller.js';
import validate from '../middleware/validate.js';
import authenticate from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import asyncHandler from '../utils/asyncHandler.js';
import { authLimiter, inviteLimiter } from '../middleware/rateLimiters.js';
import { PERMISSIONS } from '../config/permissions.js';
import { idParams, createInvitationBody, acceptInvitationBody } from '../validators/users.validators.js';

const router = Router();

// Public: the invite token is the proof
router.post('/accept', authLimiter, validate({ body: acceptInvitationBody }), asyncHandler(ctrl.accept));

// Everything below needs login + permission
router.use(authenticate, authorize(PERMISSIONS.USERS_INVITE));
router.get('/', validate({}), asyncHandler(ctrl.list));
router.post('/', inviteLimiter, validate({ body: createInvitationBody }), asyncHandler(ctrl.create));
router.delete('/:id', validate({ params: idParams }), asyncHandler(ctrl.revoke));

export default router;
