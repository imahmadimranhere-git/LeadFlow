// /api/v1/items, /api/v1/clients, /api/v1/quotes  (ERP — Sales)
import { Router } from 'express';
import authenticate from '../middleware/authenticate.js';
import authorize, { authorizeAny } from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import { requireModule } from '../services/erp/moduleAccess.js';
import * as items from '../services/erp/itemService.js';
import * as clients from '../services/erp/clientService.js';
import * as quotes from '../services/erp/quoteService.js';
import * as invoices from '../services/erp/invoiceService.js';
import * as projects from '../services/erp/projectService.js';
import * as accounting from '../services/erp/accountingService.js';
import * as v from '../validators/erp.validators.js';

const h = asyncHandler;
const canRead = authorizeAny(P.LEADS_READ_ALL, P.LEADS_READ_OWN);
const canWrite = authorize(P.LEADS_WRITE);
const canDelete = authorize(P.LEADS_DELETE);
const canManageCatalog = authorize(P.CATALOG_MANAGE);
const paged = (res, q, { items: list, total }) => sendPaginated(res, list, { page: q.page, limit: q.limit, total });

// ---------------------------------------------------------------- items (plan module SALES or ITEMS)
export const itemRouter = Router();
itemRouter.use(authenticate, requireModule('items'));
itemRouter.get('/', canRead, validate({ query: v.itemsQuery }), h(async (req, res) => paged(res, req.validated.query, await items.listItems(req.validated.query))));
itemRouter.get('/:id', canRead, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, { item: await items.getItem(req.validated.params.id) })));
itemRouter.post('/', canManageCatalog, validate({ body: v.createItemBody }), h(async (req, res) => sendSuccess(res, { item: await items.createItem(req.auth, req.validated.body) }, 201)));
itemRouter.patch('/:id', canManageCatalog, validate({ params: v.idParams, body: v.updateItemBody }), h(async (req, res) => sendSuccess(res, { item: await items.updateItem(req.auth, req.validated.params.id, req.validated.body) })));
itemRouter.delete('/:id', canManageCatalog, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, await items.deleteItem(req.auth, req.validated.params.id))));

// ---------------------------------------------------------------- clients (CRM — every plan)
export const clientRouter = Router();
clientRouter.use(authenticate);
clientRouter.get('/', canRead, validate({ query: v.clientsQuery }), h(async (req, res) => paged(res, req.validated.query, await clients.listClients(req.auth, req.validated.query))));
clientRouter.post('/', canWrite, validate({ body: v.createClientBody }), h(async (req, res) => sendSuccess(res, { client: await clients.createClient(req.auth, req.validated.body) }, 201)));
clientRouter.post('/from-lead/:leadId', canWrite, validate({ params: v.leadParams }), h(async (req, res) => {
  const r = await clients.convertLead(req.auth, req.validated.params.leadId);
  sendSuccess(res, r, r.created ? 201 : 200);
}));
clientRouter.get('/:id', canRead, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, await clients.getClient(req.auth, req.validated.params.id))));
clientRouter.patch('/:id', canWrite, validate({ params: v.idParams, body: v.updateClientBody }), h(async (req, res) => sendSuccess(res, { client: await clients.updateClient(req.auth, req.validated.params.id, req.validated.body) })));
clientRouter.delete('/:id', canDelete, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, await clients.deleteClient(req.auth, req.validated.params.id))));

// ---------------------------------------------------------------- quotes (plan module SALES)
export const quoteRouter = Router();
quoteRouter.use(authenticate, requireModule('quotes'));
quoteRouter.get('/', canRead, validate({ query: v.quotesQuery }), h(async (req, res) => paged(res, req.validated.query, await quotes.listQuotes(req.auth, req.validated.query))));
quoteRouter.post('/', canWrite, validate({ body: v.createQuoteBody }), h(async (req, res) => sendSuccess(res, { quote: await quotes.createQuote(req.auth, req.validated.body) }, 201)));
quoteRouter.get('/:id', canRead, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, await quotes.getQuote(req.auth, req.validated.params.id))));
quoteRouter.patch('/:id', canWrite, validate({ params: v.idParams, body: v.updateQuoteBody }), h(async (req, res) => sendSuccess(res, { quote: await quotes.updateQuote(req.auth, req.validated.params.id, req.validated.body) })));
quoteRouter.post('/:id/status', canWrite, validate({ params: v.idParams, body: v.statusBody }), h(async (req, res) => sendSuccess(res, { quote: await quotes.changeStatus(req.auth, req.validated.params.id, req.validated.body.status, req.validated.body) })));
quoteRouter.post('/:id/duplicate', canWrite, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, { quote: await quotes.duplicateQuote(req.auth, req.validated.params.id) }, 201)));

// ---------------------------------------------------------------- invoices + payments (plan module INVOICING)
// Reading: anyone who reads leads (Sales: own clients only). Money actions: invoices:manage.

const canManageMoney = authorize(P.INVOICES_MANAGE);
export const invoiceRouter = Router();
invoiceRouter.use(authenticate, requireModule('invoices'));
invoiceRouter.get('/', canRead, validate({ query: v.invoicesQuery }), h(async (req, res) => paged(res, req.validated.query, await invoices.listInvoices(req.auth, req.validated.query))));
invoiceRouter.get('/summary', canRead, validate({}), h(async (req, res) => sendSuccess(res, await invoices.invoiceSummary(req.auth))));
invoiceRouter.get('/payments', canRead, validate({ query: v.paymentsQuery }), h(async (req, res) => paged(res, req.validated.query, await invoices.listPayments(req.auth, req.validated.query))));
invoiceRouter.post('/payments/:id/void', canManageMoney, validate({ params: v.idParams, body: v.reasonBody }), h(async (req, res) => sendSuccess(res, await invoices.voidPayment(req.auth, req.validated.params.id, req.validated.body))));
invoiceRouter.post('/from-quote/:quoteId', canManageMoney, validate({ params: v.quoteParams }), h(async (req, res) => sendSuccess(res, { invoice: await invoices.invoiceFromQuote(req.auth, req.validated.params.quoteId) }, 201)));
invoiceRouter.post('/', canManageMoney, validate({ body: v.createInvoiceBody }), h(async (req, res) => sendSuccess(res, { invoice: await invoices.createInvoice(req.auth, req.validated.body) }, 201)));
invoiceRouter.get('/:id', canRead, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, await invoices.getInvoice(req.auth, req.validated.params.id))));
invoiceRouter.patch('/:id', canManageMoney, validate({ params: v.idParams, body: v.updateInvoiceBody }), h(async (req, res) => sendSuccess(res, { invoice: await invoices.updateInvoice(req.auth, req.validated.params.id, req.validated.body) })));
invoiceRouter.delete('/:id', canManageMoney, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, await invoices.deleteDraft(req.auth, req.validated.params.id))));
invoiceRouter.post('/:id/issue', canManageMoney, validate({ params: v.idParams, body: v.issueBody }), h(async (req, res) => sendSuccess(res, { invoice: await invoices.issueInvoice(req.auth, req.validated.params.id, req.validated.body) })));
invoiceRouter.post('/:id/void', canManageMoney, validate({ params: v.idParams, body: v.reasonBody }), h(async (req, res) => sendSuccess(res, { invoice: await invoices.voidInvoice(req.auth, req.validated.params.id, req.validated.body) })));
invoiceRouter.post('/:id/payments', canManageMoney, validate({ params: v.idParams, body: v.paymentBody }), h(async (req, res) => sendSuccess(res, await invoices.recordPayment(req.auth, req.validated.params.id, req.validated.body), 201)));

// ---------------------------------------------------------------- projects, tasks, time (plan module PROJECTS)
export const projectRouter = Router();
projectRouter.use(authenticate, requireModule('projects'));
const canManageProjects = authorize(P.PROJECTS_MANAGE);
projectRouter.get('/', canRead, validate({ query: v.projectsQuery }), h(async (req, res) => paged(res, req.validated.query, await projects.listProjects(req.auth, req.validated.query))));
projectRouter.post('/', canManageProjects, validate({ body: v.createProjectBody }), h(async (req, res) => sendSuccess(res, { project: await projects.createProject(req.auth, req.validated.body) }, 201)));
projectRouter.post('/from-quote/:quoteId', canManageProjects, validate({ params: v.quoteParams }), h(async (req, res) => sendSuccess(res, { project: await projects.projectFromQuote(req.auth, req.validated.params.quoteId) }, 201)));
projectRouter.get('/:id', canRead, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, await projects.getProject(req.auth, req.validated.params.id))));
projectRouter.patch('/:id', canWrite, validate({ params: v.idParams, body: v.updateProjectBody }), h(async (req, res) => sendSuccess(res, await projects.updateProject(req.auth, req.validated.params.id, req.validated.body))));
projectRouter.delete('/:id', canManageProjects, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, await projects.deleteProject(req.auth, req.validated.params.id))));
projectRouter.post('/:id/milestones', canWrite, validate({ params: v.idParams, body: v.milestoneBody }), h(async (req, res) => sendSuccess(res, await projects.addMilestone(req.auth, req.validated.params.id, req.validated.body), 201)));
projectRouter.patch('/:id/milestones/:milestoneId', canWrite, validate({ params: v.milestoneParams, body: v.milestoneUpdateBody }), h(async (req, res) => sendSuccess(res, await projects.updateMilestone(req.auth, req.validated.params.id, req.validated.params.milestoneId, req.validated.body))));
projectRouter.delete('/:id/milestones/:milestoneId', canWrite, validate({ params: v.milestoneParams }), h(async (req, res) => sendSuccess(res, await projects.deleteMilestone(req.auth, req.validated.params.id, req.validated.params.milestoneId))));
projectRouter.get('/:id/tasks', canRead, validate({ params: v.idParams, query: v.tasksQuery }), h(async (req, res) => sendSuccess(res, { items: await projects.listTasks(req.auth, req.validated.params.id, req.validated.query) })));
projectRouter.post('/:id/tasks', canWrite, validate({ params: v.idParams, body: v.createTaskBody }), h(async (req, res) => sendSuccess(res, { task: await projects.createTask(req.auth, req.validated.params.id, req.validated.body) }, 201)));
projectRouter.post('/:id/time', canWrite, validate({ params: v.idParams, body: v.logTimeBody }), h(async (req, res) => sendSuccess(res, { entry: await projects.logTime(req.auth, req.validated.params.id, req.validated.body) }, 201)));
projectRouter.post('/:id/invoice-time', authorize(P.INVOICES_MANAGE), requireModule('invoices'), validate({ params: v.idParams, body: v.invoiceTimeBody }), h(async (req, res) => sendSuccess(res, await projects.invoiceTime(req.auth, req.validated.params.id, req.validated.body), 201)));

export const taskRouter = Router();
taskRouter.use(authenticate, requireModule('projects'));
taskRouter.patch('/:id', canWrite, validate({ params: v.idParams, body: v.updateTaskBody }), h(async (req, res) => sendSuccess(res, { task: await projects.updateTask(req.auth, req.validated.params.id, req.validated.body) })));
taskRouter.delete('/:id', canWrite, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, await projects.deleteTask(req.auth, req.validated.params.id))));

export const timeRouter = Router();
timeRouter.use(authenticate, requireModule('projects'));
timeRouter.get('/', canRead, validate({ query: v.timeQuery }), h(async (req, res) => {
  const q = req.validated.query;
  const r = await projects.listTime(req.auth, q);
  res.status(200).json({ success: true, data: { items: r.items, totalMinutes: r.totalMinutes, pagination: { page: q.page, limit: q.limit, total: r.total, totalPages: Math.max(1, Math.ceil(r.total / q.limit)) } } });
}));
timeRouter.get('/timer', canWrite, validate({}), h(async (req, res) => sendSuccess(res, await projects.currentTimer(req.auth))));
timeRouter.post('/timer/start', canWrite, validate({ body: v.timerBody }), h(async (req, res) => sendSuccess(res, { timer: await projects.startTimer(req.auth, req.validated.body) }, 201)));
timeRouter.post('/timer/stop', canWrite, validate({}), h(async (req, res) => sendSuccess(res, await projects.stopTimer(req.auth))));
timeRouter.patch('/:id', canWrite, validate({ params: v.idParams, body: v.updateTimeBody }), h(async (req, res) => sendSuccess(res, { entry: await projects.updateTime(req.auth, req.validated.params.id, req.validated.body) })));
timeRouter.delete('/:id', canWrite, validate({ params: v.idParams }), h(async (req, res) => sendSuccess(res, await projects.deleteTime(req.auth, req.validated.params.id))));

// ---------------------------------------------------------------- accounting (plan module ACCOUNTING; accounting:manage)
export const accountingRouter = Router();
accountingRouter.use(authenticate, requireModule('accounting'), authorize(P.ACCOUNTING_MANAGE));
accountingRouter.get('/summary', validate({}), h(async (req, res) => sendSuccess(res, await accounting.accountingSummary())));
accountingRouter.get('/settings', validate({}), h(async (req, res) => sendSuccess(res, await accounting.accountingSettings())));
accountingRouter.patch('/settings', validate({ body: v.accountingSettingsBody }), h(async (req, res) => sendSuccess(res, await accounting.updateAccountingSettings(req.auth, req.validated.body))));
accountingRouter.get('/expenses', validate({ query: v.expensesQuery }), h(async (req, res) => {
  const q = req.validated.query;
  const r = await accounting.listExpenses(q);
  res.status(200).json({ success: true, data: { items: r.items, totals: r.totals, pagination: { page: q.page, limit: q.limit, total: r.total, totalPages: Math.max(1, Math.ceil(r.total / q.limit)) } } });
}));
accountingRouter.post('/expenses', validate({ body: v.createExpenseBody }), h(async (req, res) => sendSuccess(res, { expense: await accounting.createExpense(req.auth, req.validated.body) }, 201)));
accountingRouter.patch('/expenses/:id', validate({ params: v.idParams, body: v.updateExpenseBody }), h(async (req, res) => sendSuccess(res, { expense: await accounting.updateExpense(req.auth, req.validated.params.id, req.validated.body) })));
accountingRouter.post('/expenses/:id/void', validate({ params: v.idParams, body: v.reasonBody }), h(async (req, res) => sendSuccess(res, { expense: await accounting.voidExpense(req.auth, req.validated.params.id, req.validated.body) })));
accountingRouter.get('/reports/pnl', validate({ query: v.rangeQuery }), h(async (req, res) => sendSuccess(res, await accounting.profitAndLoss(req.validated.query))));
accountingRouter.get('/reports/aging', validate({}), h(async (req, res) => sendSuccess(res, await accounting.receivablesAging())));
accountingRouter.get('/reports/income-by-client', validate({ query: v.rangeQuery }), h(async (req, res) => sendSuccess(res, await accounting.incomeByClient(req.validated.query))));
accountingRouter.get('/reports/expenses', validate({ query: v.breakdownQuery }), h(async (req, res) => sendSuccess(res, await accounting.expensesBreakdown(req.validated.query))));
