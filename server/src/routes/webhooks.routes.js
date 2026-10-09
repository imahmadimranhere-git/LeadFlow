// /api/v1/webhooks/* — mounted BEFORE express.json() because signature checks need the RAW body.
import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { requestMeta } from '../utils/requestMeta.js';
import { handlePaymentWebhook } from '../services/billing/webhookService.js';
import { receiveInboundLead } from '../services/signals/inboundWebhookService.js';
import { verifySubscription, receiveWhatsAppWebhook } from '../services/conversations/whatsappInbound.js';

const router = Router();

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Too many requests', errors: [] }),
});

router.post(
  '/payments/:provider',
  webhookLimiter,
  express.raw({ type: '*/*', limit: '256kb' }),
  asyncHandler(async (req, res) => {
    if (!/^[a-z_]{2,30}$/i.test(req.params.provider)) return res.status(404).json({ success: false, message: 'Unknown webhook', errors: [] });
    const result = await handlePaymentWebhook(req.params.provider, req.body, req.headers, requestMeta(req));
    return sendSuccess(res, result);
  })
);

// Website forms / Zapier → Signals inbox. Limited per webhook key AND per IP.
const inboundLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (req) => `inbound:${String(req.params.publicKey).slice(0, 60)}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Too many requests', errors: [] }),
});

router.post(
  '/leads/:publicKey',
  webhookLimiter,
  inboundLimiter,
  express.raw({ type: '*/*', limit: '32kb' }),
  asyncHandler(async (req, res) => {
    const result = await receiveInboundLead(req.params.publicKey, req.body, req.headers, requestMeta(req));
    return sendSuccess(res, result, result.duplicate ? 200 : 201);
  })
);

// WhatsApp Cloud API (Meta). GET = one-time subscription check, POST = messages/statuses (signed).
router.get(
  '/whatsapp',
  webhookLimiter,
  asyncHandler(async (req, res) => {
    const challenge = await verifySubscription(req.query);
    res.type('text/plain').status(200).send(challenge);
  })
);
router.post(
  '/whatsapp',
  webhookLimiter,
  express.raw({ type: '*/*', limit: '512kb' }),
  asyncHandler(async (req, res) => sendSuccess(res, await receiveWhatsAppWebhook(req.body, req.headers, requestMeta(req))))
);

export default router;
