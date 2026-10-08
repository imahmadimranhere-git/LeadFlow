// /api/v1/leads/imports — CSV import (upload → preview → commit). Needs leads:write.
import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import env from '../config/env.js';
import authenticate from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import * as imports from '../services/leads/import/importService.js';
import { CSV_LIMITS } from '../services/leads/import/csvParser.js';
import * as v from '../validators/discovery.validators.js';

const router = Router();
router.use(authenticate, authorize(P.LEADS_WRITE));

// Windows/Excel sends .csv files as "application/vnd.ms-excel"; some browsers send text/plain
const CSV_TYPES = ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'];
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Math.max(10, Math.floor(env.AUTH_RATE_LIMIT_MAX / 1.5)),
  keyGenerator: (req) => `tenant:${req.auth.tenantId}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Too many uploads — try again later.', errors: [] }),
});

router.post(
  '/',
  uploadLimiter,
  express.raw({ type: CSV_TYPES, limit: CSV_LIMITS.maxBytes }),
  asyncHandler(async (req, res) => {
    let fileName = String(req.get('X-File-Name') || 'import.csv').slice(0, 200);
    try {
      fileName = decodeURIComponent(fileName);
    } catch {
      fileName = 'import.csv'; // malformed encoding → ignore the name (it is only a label)
    }
    sendSuccess(res, { import: await imports.uploadCsv(req.auth, { buffer: req.body, fileName }) }, 201);
  })
);
router.get('/:id', validate({ params: v.idParams }), asyncHandler(async (req, res) => sendSuccess(res, { import: await imports.getImport(req.auth, req.validated.params.id) })));
router.post('/:id/preview', validate({ params: v.idParams, body: v.previewBody }), asyncHandler(async (req, res) =>
  sendSuccess(res, { import: await imports.previewImport(req.auth, req.validated.params.id, req.validated.body) })));
router.post('/:id/commit', validate({ params: v.idParams }), asyncHandler(async (req, res) =>
  sendSuccess(res, { import: await imports.commitImport(req.auth, req.validated.params.id) })));

export default router;
