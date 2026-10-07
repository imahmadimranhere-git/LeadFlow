import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import userRoutes from './users.routes.js';
import invitationRoutes from './invitations.routes.js';
import superAdminRoutes from './superAdmin.routes.js';
import billingRoutes from './billing.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/invitations', invitationRoutes);
router.use('/billing', billingRoutes);
router.use('/super-admin', superAdminRoutes);

export default router;
