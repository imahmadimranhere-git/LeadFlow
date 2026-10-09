// PUBLIC: /api/v1/unsubscribe/:token — the link at the bottom of every email.
//   GET  → a small confirmation page (link scanners in mail apps open links; they must NOT unsubscribe people)
//   POST → unsubscribe (also RFC 8058 one-click from Gmail/Outlook: "List-Unsubscribe=One-Click")
// The token is signed (HMAC) — it can't be guessed or changed. No login needed, on purpose.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import asyncHandler from '../utils/asyncHandler.js';
import { unsubscribe, unsubscribePage } from '../services/outreach/outreachService.js';
import { verifyUnsubscribe } from '../utils/unsubscribeToken.js';

const router = Router();
router.use(rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }));

const html = (res, status, page) => {
  res.set('Cache-Control', 'no-store');
  res.status(status).type('html').send(page);
};

router.get('/:token', (req, res) => {
  if (!verifyUnsubscribe(req.params.token)) return html(res, 400, unsubscribePage({ error: 'This unsubscribe link is not valid.' }));
  return html(res, 200, unsubscribePage({ actionUrl: req.originalUrl }));
});

router.post('/:token', asyncHandler(async (req, res) => {
  try {
    await unsubscribe(req.params.token);
  } catch {
    return html(res, 400, unsubscribePage({ error: 'This unsubscribe link is not valid.' }));
  }
  return html(res, 200, unsubscribePage({ done: true }));
}));

export default router;
