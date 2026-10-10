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
import { messageRouter, templateRouter } from './messages.routes.js';
import websiteAuditRoutes from './websiteAudits.routes.js';
import conversationRoutes from './conversations.routes.js';
import analyticsRoutes from './analytics.routes.js';
import exportRoutes from './exports.routes.js';
import { followUpRouter, notificationRouter } from './followUps.routes.js';
import { itemRouter, clientRouter, quoteRouter, invoiceRouter, projectRouter, taskRouter, timeRouter, accountingRouter } from './erp.routes.js';
import unsubscribeRoutes from './unsubscribe.routes.js';
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
router.use('/messages', messageRouter);
router.use('/templates', templateRouter);
router.use('/website-audits', websiteAuditRoutes);
router.use('/conversations', conversationRoutes);
router.use('/follow-ups', followUpRouter);
router.use('/notifications', notificationRouter);
router.use('/items', itemRouter);
router.use('/clients', clientRouter);
router.use('/quotes', quoteRouter);
router.use('/invoices', invoiceRouter);
router.use('/projects', projectRouter);
router.use('/tasks', taskRouter);
router.use('/time', timeRouter);
router.use('/accounting', accountingRouter);
router.use('/analytics', analyticsRoutes);
router.use('/exports', exportRoutes);
router.use('/unsubscribe', unsubscribeRoutes); // public (signed token)
router.use('/super-admin', superAdminRoutes);

export default router;
