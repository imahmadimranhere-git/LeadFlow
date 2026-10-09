// ERP — Sales (Phase 20). Pure data.
export { CURRENCIES } from '../models/Plan.js';

export const ITEM_TYPES = ['PRODUCT', 'SERVICE', 'PROPERTY', 'OTHER'];
export const ITEM_STATUSES = ['ACTIVE', 'ARCHIVED'];
export const ITEM_AVAILABILITY = ['NOT_TRACKED', 'AVAILABLE', 'RESERVED', 'SOLD'];
export const CLIENT_TYPES = ['COMPANY', 'PERSON'];
export const CLIENT_STATUSES = ['ACTIVE', 'ARCHIVED'];
// DRAFT → SENT → ACCEPTED / DECLINED / EXPIRED ; CANCELLED any time before ACCEPTED
export const QUOTE_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED'];
export const QUOTE_TRANSITIONS = Object.freeze({
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'DRAFT'],
  DECLINED: ['DRAFT'],
  EXPIRED: ['DRAFT'],
  ACCEPTED: [],
  CANCELLED: [],
});
export const DISCOUNT_TYPES = ['NONE', 'PERCENT', 'AMOUNT'];
export const ERP_LIMITS = Object.freeze({ customFields: 20, clientContacts: 10, quoteLines: 100 });
// Module each area needs in the company's plan (super admin decides per plan)
export const MODULE_FOR = Object.freeze({ items: ['SALES', 'ITEMS'], quotes: ['SALES'], invoices: ['INVOICING'], projects: ['PROJECTS'], accounting: ['ACCOUNTING'] });

// ---- Invoicing (Phase 21)
// DRAFT (no number yet) → ISSUED (numbered, can't be edited) → PAID ;  VOID = cancelled with a reason (kept for the record)
export const INVOICE_STATUSES = ['DRAFT', 'ISSUING', 'ISSUED', 'PAID', 'VOID'];
export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'ONLINE', 'OTHER'];

// ---- Projects & time (Phase 22)
export const PROJECT_STATUSES = ['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];
export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'];
export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
export const TIME_STATUSES = ['OPEN', 'INVOICING', 'INVOICED'];
export const PROJECT_LIMITS = Object.freeze({ members: 50, milestones: 30, tasksPerProject: 2000, minutesPerDay: 1440, minutesPerEntry: 1440, timerMaxMinutes: 720 });

// ---- Accounting-lite (Phase 23)
export const EXPENSE_STATUSES = ['RECORDED', 'VOID'];
export const DEFAULT_EXPENSE_CATEGORIES = ['Rent', 'Salaries', 'Software & subscriptions', 'Marketing', 'Utilities', 'Travel', 'Equipment', 'Contractors', 'Bank charges', 'Taxes & fees', 'Other'];
