import { Router } from 'express';
import { dbStatus } from '../config/db.js';
import { sendSuccess } from '../utils/response.js';

const router = Router();

// GET /api/v1/health  → is the API alive + is DB connected?
// Intentionally returns NO versions, hostnames or env details (information leakage).
router.get('/', (_req, res) => {
  const db = dbStatus();
  sendSuccess(res, { status: db === 'connected' ? 'ok' : 'degraded', db, time: new Date().toISOString() },
    db === 'connected' ? 200 : 503);
});

export default router;
