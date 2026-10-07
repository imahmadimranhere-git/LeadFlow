import { z, objectId, idParams, pagination, safeText } from './common.js';
import { BILLING_CYCLES, SUBSCRIPTION_STATUSES } from '../models/Subscription.js';
import { INVOICE_STATUSES } from '../models/PlatformInvoice.js';
import { PAYMENT_METHODS } from '../models/Payment.js';

export { idParams };

// tenant
export const checkoutBody = z.object({ planId: objectId, billingCycle: z.enum(BILLING_CYCLES) }).strict();
export const cancelBody = z.object({ reason: z.string().trim().max(300).optional() }).strict();
export const invoiceListQuery = z.object({ ...pagination }).strict();

// super admin
export const adminSubscriptionsQuery = z.object({ ...pagination, status: z.enum(SUBSCRIPTION_STATUSES).optional() }).strict();
export const adminInvoicesQuery = z
  .object({ ...pagination, status: z.enum(INVOICE_STATUSES).optional(), tenantId: objectId.optional() })
  .strict();
export const markPaidBody = z
  .object({
    method: z.enum(PAYMENT_METHODS),
    reference: z.string().trim().max(200).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export const voidBody = z.object({ reason: safeText(300) }).strict();
export const overrideBody = z
  .object({
    planId: objectId,
    status: z.enum(SUBSCRIPTION_STATUSES),
    billingCycle: z.enum(BILLING_CYCLES),
    currentPeriodEnd: z.coerce.date().refine((d) => d.getTime() > Date.now() - 24 * 60 * 60 * 1000, 'Date must not be in the past'),
    reason: safeText(500),
  })
  .strict();
export const billingSettingsBody = z
  .object({
    manualPaymentInstructions: z.string().trim().max(2000).optional(),
    graceDays: z.number().int().min(0).max(30).optional(),
    invoiceDueDays: z.number().int().min(1).max(60).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, 'Nothing to update');
