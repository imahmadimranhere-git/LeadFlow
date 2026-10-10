// /api/v1/exports — CSV/PDF exports (spec A29).
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import env from '../config/env.js';
import authenticate from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { requestMeta } from '../utils/requestMeta.js';
import { PERMISSIONS as P, hasPermission } from '../config/permissions.js';
import * as exportsSvc from '../services/exports/exportService.js';
import * as v from '../validators/exports.validators.js';

const h = asyncHandler;
const router = Router();
const tooMany = (_req, res) => res.status(429).json({ success: false, message: 'Too many export requests — wait a minute.', errors: [] });

/** Sends a generated file safely: attachment, no sniffing, no caching, ASCII filename. */
export function sendFile(res, { fileName, contentType, data }) {
  res.set({
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Content-Length': String(data.length),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  res.status(200).end(data);
}

// PUBLIC (the signed link is the credential) — defined BEFORE authenticate; rate-limited per IP
const downloadLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, handler: tooMany });
router.get('/download/:token', downloadLimiter, validate({ params: v.tokenParams }), h(async (req, res) => sendFile(res, await exportsSvc.download(req.validated.params.token, requestMeta(req)))));

router.use(authenticate, authorize(P.EXPORT_RUN));
const createLimiter = rateLimit({ windowMs: 60 * 1000, limit: Math.max(10, Math.floor(env.AUTH_RATE_LIMIT_MAX / 5)), keyGenerator: (req) => `export:${req.auth.userId}`, standardHeaders: 'draft-7', legacyHeaders: false, handler: tooMany });

router.get('/catalog', validate({}), h(async (req, res) => {
  const types = await exportsSvc.catalog(req.auth);
  for (const [k, t] of Object.entries(types)) t.filters = v.FILTER_KEYS[k] || [];
  sendSuccess(res, { types, rowCap: exportsSvc.ROW_CAP, canIncludeDoNotContact: hasPermission(req.auth.role, P.TENANT_UPDATE) });
}));
router.get('/', validate({ query: v.listQuery }), h(async (req, res) => {
  const q = req.validated.query;
  const { items, total } = await exportsSvc.listExports(req.auth, q);
  sendPaginated(res, items, { page: q.page, limit: q.limit, total });
}));
router.post('/', createLimiter, validate({ body: v.createExportBody }), h(async (req, res) => sendSuccess(res, { export: await exportsSvc.createExport(req.auth, req.validated.body, requestMeta(req)) }, 202)));
router.get('/:id', validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, { export: await exportsSvc.getExport(req.auth, req.validated.params.id) })));
router.post('/:id/link', createLimiter, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, await exportsSvc.createLink(req.auth, req.validated.params.id))));

export default router;
