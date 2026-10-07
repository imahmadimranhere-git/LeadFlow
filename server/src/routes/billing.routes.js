// /api/v1/billing — the company's own plan, usage and invoices.
// Uses authenticateAllowBillingOnly: an owner of a company suspended for non-payment can still pay here.
import { Router } from 'express';
import * as ctrl from '../controllers/billing.controller.js';
import validate from '../middleware/validate.js';
import { authenticateAllowBillingOnly } from '../middleware/authenticate.js';
import authorize, { authorizeAny } from '../middleware/authorize.js';
import asyncHandler from '../utils/asyncHandler.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import * as v from '../validators/billing.validators.js';

const router = Router();
router.use(authenticateAllowBillingOnly);

router.get('/', authorize(P.BILLING_MANAGE), validate({}), asyncHandler(ctrl.overview));
router.get('/usage', authorizeAny(P.BILLING_MANAGE, P.USERS_MANAGE), validate({}), asyncHandler(ctrl.usage));
router.get('/plans', authorize(P.BILLING_MANAGE), validate({}), asyncHandler(ctrl.plans));
router.get('/invoices', authorize(P.BILLING_MANAGE), validate({ query: v.invoiceListQuery }), asyncHandler(ctrl.invoices));
router.post('/checkout', authorize(P.BILLING_MANAGE), validate({ body: v.checkoutBody }), asyncHandler(ctrl.checkout));
router.post('/cancel', authorize(P.BILLING_MANAGE), validate({ body: v.cancelBody }), asyncHandler(ctrl.cancel));
router.post('/resume', authorize(P.BILLING_MANAGE), validate({}), asyncHandler(ctrl.resume));

export default router;
