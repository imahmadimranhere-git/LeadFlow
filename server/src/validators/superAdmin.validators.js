import { z, email, safeText, objectId, idParams, pagination, sortBy } from './common.js';
import { strongPassword } from './auth.validators.js';
import { TENANT_STATUSES } from '../models/Tenant.js';
import { CURRENCIES, CONNECTORS, ERP_MODULES, LIMIT_KEYS } from '../models/Plan.js';
import { ACTOR_TYPES } from '../models/AuditLog.js';

export { idParams };

// ---- auth ----
export const adminLoginBody = z.object({ email, password: z.string().min(1).max(200) }).strict();
export const adminMfaBody = z
  .object({
    mfaToken: z.string().min(20).max(2000),
    code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  })
  .strict();
export const adminChangePasswordBody = z
  .object({ currentPassword: z.string().min(1).max(200), newPassword: strongPassword })
  .strict()
  .refine((d) => d.currentPassword !== d.newPassword, { message: 'New password must be different', path: ['newPassword'] });

// ---- tenants ----
export const listTenantsQuery = z
  .object({
    ...pagination,
    status: z.enum(TENANT_STATUSES).optional(),
    search: z.string().trim().max(60).optional(),
    planId: objectId.optional(),
    sort: sortBy(['createdAt', 'name', 'status']),
  })
  .strict();

export const tenantStatusBody = z.object({ status: z.enum(TENANT_STATUSES), reason: safeText(500) }).strict();
export const tenantPlanBody = z.object({ planId: objectId, reason: z.string().trim().max(500).optional() }).strict();
export const tenantDeleteBody = z.object({ confirmSlug: z.string().trim().max(60), reason: safeText(500) }).strict();

// ---- plans ----
const limitValue = z.number().int().min(-1).max(1_000_000_000);
const limitsSchema = z.object(Object.fromEntries(LIMIT_KEYS.map((k) => [k, limitValue]))).strict();

const planFields = {
  name: safeText(60),
  description: z.string().trim().max(500).optional(),
  currency: z.enum(CURRENCIES),
  priceMonthlyMinor: z.number().int().min(0).max(100_000_000),
  priceYearlyMinor: z.number().int().min(0).max(1_000_000_000),
  trialDays: z.number().int().min(0).max(90),
  limits: limitsSchema,
  connectors: z.array(z.enum(CONNECTORS)).max(CONNECTORS.length),
  erpModules: z.array(z.enum(ERP_MODULES)).max(ERP_MODULES.length),
  features: z.array(z.string().trim().regex(/^[a-z0-9_.-]{1,40}$/)).max(50),
  isActive: z.boolean(),
  isPublic: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
};

export const createPlanBody = z
  .object({
    code: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes').max(40),
    ...planFields,
    description: planFields.description,
    trialDays: planFields.trialDays.default(0),
    connectors: planFields.connectors.default([]),
    erpModules: planFields.erpModules.default([]),
    features: planFields.features.default([]),
    isActive: planFields.isActive.default(true),
    isPublic: planFields.isPublic.default(true),
    sortOrder: planFields.sortOrder.default(0),
  })
  .strict();

// PATCH: every field optional, limits may be partial, code can never change
export const updatePlanBody = z
  .object({
    ...Object.fromEntries(Object.entries(planFields).map(([k, v]) => [k, v.optional()])),
    limits: limitsSchema.partial().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, 'Nothing to update');

// ---- audit ----
export const listAuditQuery = z
  .object({
    ...pagination,
    tenantId: objectId.optional(),
    action: z.string().trim().regex(/^[a-z_.]{1,80}$/).optional(),
    actorType: z.enum(ACTOR_TYPES).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict();
