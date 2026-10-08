// /api/v1/settings — company profile, industry pack, ICP, discovery terms, brand voice, branding.
// Everyone in the company can READ settings (sales people need services & brand voice later);
// only roles with tenant:update can CHANGE them.
import express, { Router } from 'express';
import * as ctrl from '../controllers/settings.controller.js';
import validate from '../middleware/validate.js';
import authenticate from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import asyncHandler from '../utils/asyncHandler.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import { ALLOWED_IMAGE_TYPES } from '../models/TenantAsset.js';
import { MAX_LOGO_BYTES } from '../services/settings/logoService.js';
import * as v from '../validators/settings.validators.js';

const router = Router();
router.use(authenticate);

const canRead = authorize(P.TENANT_READ);
const canEdit = authorize(P.TENANT_UPDATE);

router.get('/', canRead, validate({}), asyncHandler(ctrl.get));
router.get('/industry-packs', canRead, validate({}), asyncHandler(ctrl.listPacks));
router.post('/industry-pack', canEdit, validate({ body: v.applyPackBody }), asyncHandler(ctrl.applyPack));
router.post('/onboarding/complete', canEdit, validate({ body: v.onboardingCompleteBody }), asyncHandler(ctrl.completeOnboarding));

const SECTIONS = {
  profile: v.profileBody,
  services: v.servicesBody,
  icp: v.icpBody,
  discovery: v.discoveryBody,
  'brand-voice': v.brandVoiceBody,
  branding: v.brandingBody,
  pipeline: v.pipelineBody,
  scoring: v.scoringBody,
  ai: v.aiBody,
};
const SECTION_KEYS = { 'brand-voice': 'brandVoice' };
for (const [path, schema] of Object.entries(SECTIONS)) {
  router.patch(`/${path}`, canEdit, validate({ body: schema }), asyncHandler(ctrl.updateSection(SECTION_KEYS[path] || path)));
}

// Logo: raw image body (not JSON). Only these content types are even read; max 256 KB.
router.get('/branding/logo', canRead, validate({ query: v.logoQuery }), asyncHandler(ctrl.getLogo));
router.put(
  '/branding/logo',
  canEdit,
  express.raw({ type: ALLOWED_IMAGE_TYPES, limit: MAX_LOGO_BYTES }),
  asyncHandler(ctrl.uploadLogo)
);
router.delete('/branding/logo', canEdit, validate({}), asyncHandler(ctrl.removeLogo));

export default router;
