// /api/v1/webhooks/* — mounted BEFORE express.json() because signature checks need the RAW body.
import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { requestMeta } from '../utils/requestMeta.js';
import { handlePaymentWebhook } from '../services/billing/webhookService.js';

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

export default router;
