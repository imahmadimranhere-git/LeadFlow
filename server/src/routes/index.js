import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import userRoutes from './users.routes.js';
import invitationRoutes from './invitations.routes.js';
import superAdminRoutes from './superAdmin.routes.js';
import billingRoutes from './billing.routes.js';
import settingsRoutes from './settings.routes.js';
import integrationRoutes, { metaCallbackRouter } from './integrations.routes.js';
import { watchRouter, signalRouter } from './signals.routes.js';
import extensionRoutes from './extension.routes.js';
import aiRoutes from './ai.routes.js';
import leadRoutes from './leads.routes.js';
import importRoutes from './imports.routes.js';
import discoveryRoutes from './discovery.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/invitations', invitationRoutes);
router.use('/billing', billingRoutes);
router.use('/settings', settingsRoutes);
router.use('/integrations/meta/oauth/callback', metaCallbackRouter); // public (before the authenticated router)
router.use('/integrations', integrationRoutes);
router.use('/leads/imports', importRoutes); // before /leads so it isn't read as a lead id
router.use('/leads', leadRoutes);
router.use('/discovery', discoveryRoutes);
router.use('/hashtag-watches', watchRouter);
router.use('/signals', signalRouter);
router.use('/extension', extensionRoutes);
router.use('/ai', aiRoutes);
router.use('/super-admin', superAdminRoutes);

export default router;
