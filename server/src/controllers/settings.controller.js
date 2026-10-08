import * as settingsService from '../services/settings/settingsService.js';
import * as logoService from '../services/settings/logoService.js';
import { sendSuccess } from '../utils/response.js';

export const get = async (req, res) => sendSuccess(res, { settings: await settingsService.getSettings(req.auth.tenantId) });
export const listPacks = async (_req, res) => sendSuccess(res, { items: await settingsService.listActivePacks() });
export const applyPack = async (req, res) => sendSuccess(res, { settings: await settingsService.applyIndustryPack(req.auth, req.validated.body) });
export const completeOnboarding = async (req, res) =>
  sendSuccess(res, { settings: await settingsService.completeOnboarding(req.auth, req.validated.body) });

/** One handler per section: PATCH /settings/<section> */
export const updateSection = (section) => async (req, res) =>
  sendSuccess(res, { settings: await settingsService.updateSection(req.auth, section, req.validated.body) });

export async function uploadLogo(req, res) {
  const declaredType = (req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  sendSuccess(res, await logoService.uploadLogo(req.auth, { buffer: req.body, declaredType }));
}

export const removeLogo = async (req, res) => sendSuccess(res, await logoService.removeLogo(req.auth));

export async function getLogo(req, res) {
  const logo = await logoService.getLogo(req.auth.tenantId);
  if (!logo) return res.status(404).json({ success: false, message: 'No logo', errors: [] });
  const etag = `"${logo.sha256.slice(0, 32)}"`;
  res.set({
    'Content-Type': logo.contentType, // only png/jpeg/webp can ever be stored
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Content-Disposition': 'inline; filename="logo"',
    'Cache-Control': 'private, max-age=300',
    ETag: etag,
  });
  if (req.get('If-None-Match') === etag) return res.status(304).end();
  return res.send(logo.data);
}
