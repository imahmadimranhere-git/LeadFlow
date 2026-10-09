// ERP — Sales inputs. Money is typed in normal units ("1250.50") and converted to integer minor units here;
// percentages ("17.5") become basis points (1750); quantities ("1.5") become thousandths (1500).
// Negative / NaN / "1e9" / too many decimals are refused BEFORE any business logic runs.
import { z, objectId, idParams, pagination, email, httpUrl } from './common.js';
import { ITEM_TYPES, ITEM_STATUSES, ITEM_AVAILABILITY, CLIENT_TYPES, CLIENT_STATUSES, QUOTE_STATUSES, DISCOUNT_TYPES, ERP_LIMITS, CURRENCIES, PAYMENT_METHODS, PROJECT_STATUSES, TASK_STATUSES, TASK_PRIORITIES } from '../config/erpOptions.js';
import { toMinor, toQtyMilli } from '../services/erp/quoteMath.js';
import { parseDuration } from '../services/erp/projectRules.js';

export { idParams };

const clean = (s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
const text = (max) => z.string().trim().max(max).transform(clean);
const numLike = z.union([z.string().max(30), z.number()]);
const conv = (fn, message) => numLike.transform((v, ctx) => {
  const r = fn(v);
  if (r === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    return z.NEVER;
  }
  return r;
});
export const money = conv(toMinor, 'Enter an amount like 1250 or 1250.50 (no minus, max 2 decimals)');
export const percent = conv((v) => {
  const bp = toMinor(v);
  return bp !== null && bp <= 10000 ? bp : null;
}, 'Enter a percentage from 0 to 100 (max 2 decimals)');
export const quantity = conv(toQtyMilli, 'Quantity must be more than 0 (max 3 decimals)');

const customFields = z
  .record(z.string().regex(/^[A-Za-z][\w ]{0,39}$/, 'Field names: letters, numbers, spaces'), z.string().trim().max(500).transform(clean))
  .refine((o) => Object.keys(o).length <= ERP_LIMITS.customFields, `At most ${ERP_LIMITS.customFields} custom fields`);

// ---------------------------------------------------------------- items
const itemFields = {
  name: text(150).pipe(z.string().min(1, 'Required')),
  type: z.enum(ITEM_TYPES),
  sku: text(60).nullable(),
  description: text(2000),
  unit: text(30),
  price: money,
  tax: percent,
  status: z.enum(ITEM_STATUSES),
  availability: z.enum(ITEM_AVAILABILITY),
  stockQty: z.number().int().min(0).max(1e9).nullable(),
  customFields,
};
const itemOut = ({ price, tax, sku, ...rest }) => ({ ...rest, ...(price !== undefined && { priceMinor: price }), ...(tax !== undefined && { taxBp: tax }), ...(sku !== undefined && { sku: sku || null }) });
export const createItemBody = z.object(itemFields).partial().required({ name: true, price: true }).strict().transform(itemOut);
export const updateItemBody = z.object(itemFields).partial().strict().refine((d) => Object.keys(d).length > 0, 'Nothing to update').transform(itemOut);
export const itemsQuery = z.object({ ...pagination, q: z.string().trim().max(80).optional(), type: z.enum(ITEM_TYPES).optional(), status: z.enum(ITEM_STATUSES).optional(), availability: z.enum(ITEM_AVAILABILITY).optional() }).strict();

// ---------------------------------------------------------------- clients
const contact = z.object({ name: text(120), role: text(80).optional(), email: email.nullable().optional(), phone: z.string().trim().max(30).regex(/^[+0-9\s\-().]*$/, 'Invalid phone').nullable().optional() }).strict();
const clientFields = {
  type: z.enum(CLIENT_TYPES),
  name: text(150).pipe(z.string().min(1, 'Required')),
  email: email.nullable(),
  phone: z.string().trim().max(30).regex(/^[+0-9\s\-().]*$/, 'Invalid phone').nullable(),
  website: httpUrl.nullable(),
  address: text(300).nullable(),
  city: text(60).nullable(),
  country: text(60).nullable(),
  taxId: text(60).nullable(),
  notes: text(2000),
  contacts: z.array(contact).max(ERP_LIMITS.clientContacts),
  status: z.enum(CLIENT_STATUSES),
};
export const createClientBody = z.object(clientFields).partial().required({ name: true }).strict();
export const updateClientBody = z.object(clientFields).partial().strict().refine((d) => Object.keys(d).length > 0, 'Nothing to update');
export const clientsQuery = z.object({ ...pagination, q: z.string().trim().max(80).optional(), status: z.enum(CLIENT_STATUSES).optional() }).strict();
export const leadParams = z.object({ leadId: objectId }).strict();

// ---------------------------------------------------------------- quotes
const line = z
  .object({
    itemId: objectId.nullable().optional(),
    description: text(500).optional(),
    unit: text(30).optional(),
    quantity,
    unitPrice: money.optional(), // empty = catalog price
    discount: percent.optional(),
    tax: percent.optional(),
    // anything a browser "calculated" is rejected — the server calculates
  })
  .strict()
  .transform(({ quantity: q, unitPrice, discount, tax, ...rest }) => ({ ...rest, qtyMilli: q, ...(unitPrice !== undefined && { unitPriceMinor: unitPrice }), ...(discount !== undefined && { discountBp: discount }), ...(tax !== undefined && { taxBp: tax }) }));
const discount = z
  .object({ type: z.enum(DISCOUNT_TYPES), value: numLike.optional() })
  .strict()
  .transform((d, ctx) => {
    if (d.type === 'NONE') return { type: 'NONE' };
    const v = d.type === 'PERCENT' ? (() => { const bp = toMinor(d.value ?? ''); return bp !== null && bp <= 10000 ? bp : null; })() : toMinor(d.value ?? '');
    if (v === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'Enter a valid discount' });
      return z.NEVER;
    }
    return d.type === 'PERCENT' ? { type: 'PERCENT', valueBp: v } : { type: 'AMOUNT', valueMinor: v };
  });
const quoteFields = {
  title: text(150),
  clientId: objectId.nullable(),
  leadId: objectId.nullable(),
  issueDate: z.coerce.date(),
  validUntil: z.coerce.date(),
  lines: z.array(line).min(1, 'Add at least one line').max(ERP_LIMITS.quoteLines),
  discount,
  notes: text(3000),
  terms: text(3000),
  internalNote: text(1000),
};
export const createQuoteBody = z.object(quoteFields).partial().required({ lines: true }).strict();
export const updateQuoteBody = z.object(quoteFields).partial().strict().refine((d) => Object.keys(d).length > 0, 'Nothing to update');
export const quotesQuery = z.object({ ...pagination, status: z.enum(QUOTE_STATUSES).optional(), clientId: objectId.optional(), leadId: objectId.optional(), q: z.string().trim().max(80).optional() }).strict();
export const statusBody = z.object({ status: z.enum(['SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'DRAFT']), note: text(300).optional() }).strict();

// ---------------------------------------------------------------- settings → sales
export const salesSettingsBody = z
  .object({
    currency: z.enum(CURRENCIES).optional(),
    defaultTax: percent.optional(),
    salesMaxDiscount: percent.optional(),
    quoteValidityDays: z.number().int().min(1).max(365).optional(),
    quotePrefix: z.string().trim().regex(/^[A-Z]{1,6}$/, '1–6 capital letters').optional(),
    quoteTerms: text(3000).optional(),
    taxId: text(60).optional(),
    invoicePrefix: z.string().trim().regex(/^[A-Z]{1,6}$/, '1–6 capital letters').optional(),
    paymentTermsDays: z.number().int().min(0).max(365).optional(),
    invoiceFooter: text(2000).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, 'Nothing to update')
  .transform(({ defaultTax, salesMaxDiscount, ...rest }) => ({ ...rest, ...(defaultTax !== undefined && { defaultTaxBp: defaultTax }), ...(salesMaxDiscount !== undefined && { salesMaxDiscountBp: salesMaxDiscount }) }));

// ---------------------------------------------------------------- invoices (Phase 21)
const invoiceFields = {
  title: text(150),
  clientId: objectId,
  dueDate: z.coerce.date(),
  lines: quoteFields.lines,
  discount,
  notes: text(3000),
  footer: text(2000),
  internalNote: text(1000),
};
export const createInvoiceBody = z.object(invoiceFields).partial().required({ clientId: true, lines: true }).strict();
export const updateInvoiceBody = z.object(invoiceFields).partial().strict().refine((d) => Object.keys(d).length > 0, 'Nothing to update');
export const invoicesQuery = z
  .object({ ...pagination, status: z.enum(['DRAFT', 'ISSUED', 'PAID', 'VOID']).optional(), clientId: objectId.optional(), overdue: z.enum(['true', 'false']).transform((v) => v === 'true').optional(), q: z.string().trim().max(80).optional() })
  .strict();
export const issueBody = z.object({ issueDate: z.coerce.date().optional(), dueDate: z.coerce.date().optional() }).strict();
export const reasonBody = z.object({ reason: text(300).pipe(z.string().min(3, 'Write a short reason')) }).strict();
export const paymentBody = z
  .object({
    amount: money,
    method: z.enum(PAYMENT_METHODS),
    reference: text(120).optional(),
    paidAt: z.coerce.date().optional(),
    note: text(300).optional(),
  })
  .strict()
  .transform(({ amount, ...rest }) => ({ ...rest, amountMinor: amount }));
export const paymentsQuery = z.object({ ...pagination, clientId: objectId.optional() }).strict();
export const quoteParams = z.object({ quoteId: objectId }).strict();

// ---------------------------------------------------------------- projects / tasks / time (Phase 22)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((d) => !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime()), 'Invalid date');
const duration = z.union([z.string().max(20), z.number()]).transform((v, ctx) => {
  const m = parseDuration(v);
  if (m === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter time like 1:30, 90, 1.5h or 1h 30m (max 24 h)' });
    return z.NEVER;
  }
  return m;
});
const projectFields = {
  name: text(150).pipe(z.string().min(1, 'Required')),
  description: text(3000),
  clientId: objectId.nullable(),
  status: z.enum(PROJECT_STATUSES),
  startDate: z.coerce.date().nullable(),
  dueDate: z.coerce.date().nullable(),
  managerId: objectId,
  members: z.array(objectId).max(50),
  billable: z.boolean(),
  hourlyRate: money,
  budgetHours: z.number().min(0).max(100000).nullable(),
  budget: money.nullable(),
};
const projectOut = ({ hourlyRate, budgetHours, budget, ...rest }) => ({
  ...rest,
  ...(hourlyRate !== undefined && { hourlyRateMinor: hourlyRate }),
  ...(budgetHours !== undefined && { budgetMinutes: budgetHours === null ? null : Math.round(budgetHours * 60) }),
  ...(budget !== undefined && { budgetMinor: budget }),
});
export const createProjectBody = z.object(projectFields).partial().required({ name: true }).strict().transform(projectOut);
export const updateProjectBody = z.object(projectFields).partial().strict().refine((d) => Object.keys(d).length > 0, 'Nothing to update').transform(projectOut);
export const projectsQuery = z.object({ ...pagination, status: z.enum(PROJECT_STATUSES).optional(), clientId: objectId.optional(), q: z.string().trim().max(80).optional() }).strict();
export const milestoneBody = z.object({ name: text(120).pipe(z.string().min(1)), dueDate: z.coerce.date().nullable().optional() }).strict();
export const milestoneUpdateBody = z.object({ name: text(120).pipe(z.string().min(1)).optional(), dueDate: z.coerce.date().nullable().optional(), status: z.enum(['OPEN', 'DONE']).optional() }).strict();
export const milestoneParams = z.object({ id: objectId, milestoneId: objectId }).strict();
const taskFields = {
  title: text(200).pipe(z.string().min(1, 'Required')),
  description: text(5000),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  assigneeId: objectId.nullable(),
  milestoneId: objectId.nullable(),
  dueDate: z.coerce.date().nullable(),
  estimate: duration.nullable(),
  position: z.number().min(-1e9).max(1e9),
};
const taskOut = ({ estimate, ...rest }) => ({ ...rest, ...(estimate !== undefined && { estimateMinutes: estimate }) });
export const createTaskBody = z.object(taskFields).partial().required({ title: true }).strict().transform(taskOut);
export const updateTaskBody = z.object(taskFields).partial().strict().refine((d) => Object.keys(d).length > 0, 'Nothing to update').transform(taskOut);
export const tasksQuery = z.object({ status: z.enum(TASK_STATUSES).optional(), assigneeId: z.union([objectId, z.literal('me')]).optional(), milestoneId: objectId.optional() }).strict();
export const logTimeBody = z
  .object({ taskId: objectId.nullable().optional(), time: duration, day: day.optional(), note: text(500).optional(), billable: z.boolean().optional(), userId: objectId.optional() })
  .strict()
  .transform(({ time, ...rest }) => ({ ...rest, minutes: time }));
export const updateTimeBody = z
  .object({ taskId: objectId.nullable().optional(), time: duration.optional(), day: day.optional(), note: text(500).optional(), billable: z.boolean().optional() })
  .strict()
  .refine((d) => Object.keys(d).length > 0, 'Nothing to update')
  .transform(({ time, ...rest }) => ({ ...rest, ...(time !== undefined && { minutes: time }) }));
export const timeQuery = z.object({ ...pagination, projectId: objectId.optional(), userId: z.union([objectId, z.literal('me')]).optional(), from: day.optional(), to: day.optional(), status: z.enum(['OPEN', 'INVOICED']).optional() }).strict();
export const timerBody = z.object({ projectId: objectId, taskId: objectId.nullable().optional(), note: text(500).optional() }).strict();
export const invoiceTimeBody = z.object({ to: day.optional() }).strict();

// ---------------------------------------------------------------- accounting (Phase 23)
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
const expenseFields = {
  day,
  amount: money.refine((m) => m > 0, 'Must be more than 0'),
  category: text(40).pipe(z.string().min(1, 'Required')),
  vendor: text(120),
  description: text(500),
  method: z.enum(PAYMENT_METHODS),
  reference: text(120),
  projectId: objectId.nullable(),
};
const expenseOut = ({ amount, ...rest }) => ({ ...rest, ...(amount !== undefined && { amountMinor: amount }) });
export const createExpenseBody = z.object(expenseFields).partial().required({ amount: true, category: true }).strict().transform(expenseOut);
export const updateExpenseBody = z.object(expenseFields).partial().strict().refine((d) => Object.keys(d).length > 0, 'Nothing to update').transform(expenseOut);
export const expensesQuery = z.object({ ...pagination, from: day.optional(), to: day.optional(), category: z.string().trim().max(40).optional(), projectId: objectId.optional(), status: z.enum(['RECORDED', 'VOID']).optional(), q: z.string().trim().max(80).optional() }).strict();
export const rangeQuery = z.object({ from: month, to: month }).strict();
export const breakdownQuery = z.object({ from: month, to: month, by: z.enum(['category', 'project']).default('category') }).strict();
export const accountingSettingsBody = z
  .object({
    expenseCategories: z.array(text(40).pipe(z.string().min(1))).min(1).max(50).optional(),
    lockedUntil: day.nullable().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, 'Nothing to update');
