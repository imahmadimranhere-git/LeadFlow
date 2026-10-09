// Projects, milestones, tasks, time tracking (spec A12 module 3).
//
// Who can do what (checked here, on the server):
//   - see a project: managers/admins/owner (leads:read:all) — or its manager / members
//   - create projects, change members / rate / budget / milestones, edit anyone's time: projects:manage
//   - members (with leads:write): add & move tasks, log THEIR OWN time
//   - invoice unbilled time: invoices:manage (creates a DRAFT invoice; entries are locked to it)
// Time rules: whole minutes; max 24 h per person per day (atomic counter); one running timer per person;
// invoiced time is locked; voiding/deleting that invoice releases the time again.
import crypto from 'node:crypto';
import Project from '../../models/Project.js';
import Task from '../../models/Task.js';
import TimeEntry from '../../models/TimeEntry.js';
import TimeDayTotal from '../../models/TimeDayTotal.js';
import Client from '../../models/Client.js';
import Quote from '../../models/Quote.js';
import User from '../../models/User.js';
import ClientInvoice from '../../models/ClientInvoice.js';
import ApiError from '../../utils/ApiError.js';
import { buildPagination, escapeRegex } from '../../utils/queryBuilder.js';
import { PERMISSIONS as P, hasPermission } from '../../config/permissions.js';
import { PROJECT_LIMITS } from '../../config/erpOptions.js';
import { zonedDayKey } from '../../utils/zonedTime.js';
import { recordAudit } from '../audit/auditService.js';
import { notify } from '../notifications/notificationService.js';
import { clientScope } from './clientService.js';
import { salesSettings, applyTotals } from './quoteService.js';
import { companyClock } from '../followUps/followUpService.js';
import { timerMinutes, timeToInvoiceLines, projectProgress } from './projectRules.js';

const manages = (auth) => hasPermission(auth.role, P.PROJECTS_MANAGE);
const readsAll = (auth) => hasPermission(auth.role, P.LEADS_READ_ALL);
const canWrite = (auth) => hasPermission(auth.role, P.LEADS_WRITE);
const audit = (auth, action, targetType, id, metadata = {}) => recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action, targetType, targetId: id, metadata });

const projectScope = (auth) => (readsAll(auth) ? {} : { $or: [{ managerId: auth.userId }, { members: auth.userId }] });

async function loadProject(auth, id) {
  const p = await Project.findOne({ $and: [{ _id: id }, projectScope(auth)] });
  if (!p) throw ApiError.notFound('Project not found');
  return p;
}
const isInvolved = (auth, p) => String(p.managerId) === String(auth.userId) || p.members.some((m) => String(m) === String(auth.userId));
function assertCanWork(auth, p) {
  if (!canWrite(auth)) throw ApiError.forbidden('You can only view this project.');
  if (!manages(auth) && !isInvolved(auth, p)) throw ApiError.forbidden('Only project members can do this.');
  if (['COMPLETED', 'CANCELLED'].includes(p.status)) throw ApiError.conflict(`This project is ${p.status.toLowerCase()} — reopen it first.`);
}
function assertManages(auth, p) {
  if (!manages(auth) && String(p.managerId) !== String(auth.userId)) throw ApiError.forbidden('Only the project manager can do this.');
}

async function assertUsers(ids) {
  const unique = [...new Set(ids.map(String))];
  if (!unique.length) return [];
  const found = await User.find({ _id: { $in: unique }, status: 'ACTIVE' }).select('_id'); // tenant-scoped → other companies' users are "not found"
  if (found.length !== unique.length) throw ApiError.badRequest('Validation failed', [{ field: 'members', message: 'Team member not found' }]);
  return unique;
}

async function today() {
  const { timezone } = await companyClock();
  return zonedDayKey(new Date(), timezone);
}

// ---------------------------------------------------------------- projects

export async function listProjects(auth, { page, limit, status, clientId, q }) {
  const { skip } = buildPagination(page, limit);
  const and = [projectScope(auth)];
  if (status) and.push({ status });
  if (clientId) and.push({ clientId });
  if (q) and.push({ name: new RegExp(escapeRegex(q), 'i') });
  const filter = { $and: and.filter((f) => Object.keys(f).length) };
  if (!filter.$and.length) delete filter.$and;
  const [items, total] = await Promise.all([
    Project.find(filter).sort({ updatedAt: -1, _id: -1 }).skip(skip).limit(limit).populate('clientId', 'name').populate('managerId', 'name'),
    Project.countDocuments(filter),
  ]);
  const ids = items.map((p) => p._id);
  const [taskAgg, timeAgg] = await Promise.all([
    Task.aggregate([{ $match: { projectId: { $in: ids } } }, { $group: { _id: '$projectId', total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ['$status', 'DONE'] }, 1, 0] } } } }]),
    TimeEntry.aggregate([{ $match: { projectId: { $in: ids }, running: false } }, { $group: { _id: '$projectId', minutes: { $sum: '$minutes' } } }]),
  ]);
  const t = new Map(taskAgg.map((x) => [String(x._id), x]));
  const m = new Map(timeAgg.map((x) => [String(x._id), x.minutes]));
  return {
    items: items.map((p) => {
      const tk = t.get(String(p._id)) || { total: 0, done: 0 };
      return { ...p.toJSON(), tasksTotal: tk.total, tasksDone: tk.done, minutesLogged: m.get(String(p._id)) || 0 };
    }),
    total,
  };
}

export async function getProject(auth, id) {
  const p = await loadProject(auth, id);
  const involved = isInvolved(auth, p);
  const isManager = manages(auth) || String(p.managerId) === String(auth.userId);
  await p.populate([{ path: 'clientId', select: 'name' }, { path: 'quoteId', select: 'number totalMinor currency' }, { path: 'managerId', select: 'name' }, { path: 'members', select: 'name role' }]);
  const [tasks, minutesAgg, unbilledAgg] = await Promise.all([
    Task.find({ projectId: p._id }).select('status dueDate'),
    TimeEntry.aggregate([{ $match: { projectId: p._id, running: false } }, { $group: { _id: null, minutes: { $sum: '$minutes' } } }]),
    TimeEntry.aggregate([{ $match: { projectId: p._id, running: false, billable: true, status: 'OPEN' } }, { $group: { _id: null, minutes: { $sum: '$minutes' }, count: { $sum: 1 } } }]),
  ]);
  return {
    project: p.toJSON(),
    progress: projectProgress({ tasks, milestones: p.milestones, minutesLogged: minutesAgg[0]?.minutes || 0, budgetMinutes: p.budgetMinutes }),
    unbilled: { minutes: unbilledAgg[0]?.minutes || 0, entries: unbilledAgg[0]?.count || 0 },
    can: { manage: isManager, work: canWrite(auth) && (manages(auth) || involved), invoice: hasPermission(auth.role, P.INVOICES_MANAGE) },
  };
}

export async function createProject(auth, data, extra = {}) {
  const settings = await salesSettings();
  let client = null;
  if (data.clientId) {
    client = await Client.findOne({ $and: [{ _id: data.clientId }, clientScope(auth)] });
    if (!client) throw ApiError.badRequest('Validation failed', [{ field: 'clientId', message: 'Client not found' }]);
  }
  const managerId = data.managerId || auth.userId;
  const members = await assertUsers([...(data.members || []), managerId]);
  if (members.length > PROJECT_LIMITS.members) throw ApiError.badRequest(`At most ${PROJECT_LIMITS.members} members.`);
  const p = await Project.create({ ...data, clientId: client?._id || null, managerId, members, currency: settings.currency, createdBy: auth.userId, ...extra });
  await audit(auth, 'project.created', 'Project', p._id);
  return p.toJSON();
}

/** Won deal → project: client, quote, budget = quote total. Once per quote. */
export async function projectFromQuote(auth, quoteId) {
  const q = await Quote.findOne({ _id: quoteId });
  if (!q) throw ApiError.notFound('Quote not found');
  if (q.status !== 'ACCEPTED' || !q.clientId) throw ApiError.conflict('Only accepted quotes (with a client) can start a project.');
  try {
    return await createProject(
      auth,
      { name: (q.title || `Project for quote ${q.number}`).slice(0, 150), clientId: q.clientId, members: q.ownerId ? [q.ownerId] : [] },
      { quoteId: q._id, budgetMinor: q.totalMinor, currency: q.currency } // unique index → a second project for this quote fails before anything is saved
    );
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('This quote already has a project.');
    throw err;
  }
}

export async function updateProject(auth, id, data) {
  const p = await loadProject(auth, id);
  assertManages(auth, p);
  if (data.members !== undefined || data.managerId !== undefined) {
    const managerId = data.managerId || p.managerId;
    data.members = await assertUsers([...(data.members ?? p.members), managerId]);
    if (data.members.length > PROJECT_LIMITS.members) throw ApiError.badRequest(`At most ${PROJECT_LIMITS.members} members.`);
    if (data.managerId && !manages(auth)) throw ApiError.forbidden('Only managers can hand a project to someone else.');
  }
  if (data.clientId !== undefined && data.clientId !== null) {
    const c = await Client.findOne({ $and: [{ _id: data.clientId }, clientScope(auth)] });
    if (!c) throw ApiError.badRequest('Validation failed', [{ field: 'clientId', message: 'Client not found' }]);
  }
  if (data.hourlyRateMinor !== undefined && data.hourlyRateMinor !== p.hourlyRateMinor) {
    await audit(auth, 'project.rate_changed', 'Project', p._id, { from: p.hourlyRateMinor, to: data.hourlyRateMinor }); // already-logged time keeps its rate
  }
  for (const [k, v] of Object.entries(data)) p.set(k, v);
  try {
    await p.save();
  } catch (err) {
    if (err.name === 'VersionError') throw ApiError.conflict('Someone else changed this project — reload.');
    throw err;
  }
  return getProject(auth, p._id);
}

export async function deleteProject(auth, id) {
  const p = await loadProject(auth, id);
  if (!manages(auth)) throw ApiError.forbidden('Only managers can delete projects.');
  if (await TimeEntry.exists({ projectId: p._id, status: { $ne: 'OPEN' } })) throw ApiError.conflict('This project has invoiced time — set it to Cancelled/Completed instead.');
  await Project.updateOne({ _id: p._id }, { $set: { deletedAt: new Date(), deletedBy: auth.userId } });
  await audit(auth, 'project.deleted', 'Project', p._id);
  return { deleted: true };
}

// ---------------------------------------------------------------- milestones (inside the project)

export async function addMilestone(auth, projectId, { name, dueDate }) {
  const p = await loadProject(auth, projectId);
  assertManages(auth, p);
  const r = await Project.updateOne({ _id: p._id, [`milestones.${PROJECT_LIMITS.milestones - 1}`]: { $exists: false } }, { $push: { milestones: { name, dueDate: dueDate || null } } });
  if (!r.modifiedCount) throw ApiError.badRequest(`At most ${PROJECT_LIMITS.milestones} milestones.`);
  return getProject(auth, p._id);
}

export async function updateMilestone(auth, projectId, milestoneId, data) {
  const p = await loadProject(auth, projectId);
  assertManages(auth, p);
  const ms = p.milestones.id(milestoneId);
  if (!ms) throw ApiError.notFound('Milestone not found');
  if (data.name !== undefined) ms.name = data.name;
  if (data.dueDate !== undefined) ms.dueDate = data.dueDate;
  if (data.status !== undefined) {
    ms.status = data.status;
    ms.completedAt = data.status === 'DONE' ? new Date() : null;
  }
  await p.save();
  return getProject(auth, p._id);
}

export async function deleteMilestone(auth, projectId, milestoneId) {
  const p = await loadProject(auth, projectId);
  assertManages(auth, p);
  if (!p.milestones.id(milestoneId)) throw ApiError.notFound('Milestone not found');
  await Project.updateOne({ _id: p._id }, { $pull: { milestones: { _id: milestoneId } } });
  await Task.updateMany({ projectId: p._id, milestoneId }, { $set: { milestoneId: null } });
  return getProject(auth, p._id);
}

// ---------------------------------------------------------------- tasks

async function checkTaskRefs(p, data) {
  if (data.assigneeId && !(String(p.managerId) === String(data.assigneeId) || p.members.some((m) => String(m) === String(data.assigneeId)))) {
    throw ApiError.badRequest('Validation failed', [{ field: 'assigneeId', message: 'Add this person to the project first' }]);
  }
  if (data.milestoneId && !p.milestones.id(data.milestoneId)) throw ApiError.badRequest('Validation failed', [{ field: 'milestoneId', message: 'Milestone not found in this project' }]);
}

const taskAssigned = (auth, task, p) =>
  task.assigneeId && String(task.assigneeId) !== String(auth.userId)
    ? notify({ userIds: [task.assigneeId], type: 'TASK_ASSIGNED', title: `New task: ${task.title}`, body: p.name, link: `/app/projects/${p._id}?task=${task._id}` })
    : null;

export async function listTasks(auth, projectId, { status, assigneeId, milestoneId }) {
  const p = await loadProject(auth, projectId);
  const filter = { projectId: p._id };
  if (status) filter.status = status;
  if (assigneeId) filter.assigneeId = assigneeId === 'me' ? auth.userId : assigneeId;
  if (milestoneId) filter.milestoneId = milestoneId;
  const items = await Task.find(filter).sort({ status: 1, position: 1, createdAt: 1 }).limit(PROJECT_LIMITS.tasksPerProject).populate('assigneeId', 'name');
  return items.map((t) => t.toJSON());
}

export async function createTask(auth, projectId, data) {
  const p = await loadProject(auth, projectId);
  assertCanWork(auth, p);
  await checkTaskRefs(p, data);
  if ((await Task.countDocuments({ projectId: p._id })) >= PROJECT_LIMITS.tasksPerProject) throw ApiError.badRequest(`At most ${PROJECT_LIMITS.tasksPerProject} tasks per project.`);
  const last = await Task.findOne({ projectId: p._id, status: data.status || 'TODO' }).sort({ position: -1 }).select('position');
  const task = await Task.create({ ...data, projectId: p._id, position: (last?.position || 0) + 1, completedAt: data.status === 'DONE' ? new Date() : null, createdBy: auth.userId });
  await taskAssigned(auth, task, p);
  return (await task.populate('assigneeId', 'name')).toJSON();
}

export async function updateTask(auth, taskId, data) {
  const task = await Task.findOne({ _id: taskId });
  if (!task) throw ApiError.notFound('Task not found');
  const p = await loadProject(auth, task.projectId);
  assertCanWork(auth, p);
  await checkTaskRefs(p, data);
  const reassigned = data.assigneeId !== undefined && String(data.assigneeId) !== String(task.assigneeId);
  for (const [k, v] of Object.entries(data)) task.set(k, v);
  if (data.status !== undefined) task.completedAt = data.status === 'DONE' ? task.completedAt || new Date() : null;
  await task.save();
  if (reassigned) await taskAssigned(auth, task, p);
  return (await task.populate('assigneeId', 'name')).toJSON();
}

export async function deleteTask(auth, taskId) {
  const task = await Task.findOne({ _id: taskId });
  if (!task) throw ApiError.notFound('Task not found');
  const p = await loadProject(auth, task.projectId);
  if (!manages(auth) && String(p.managerId) !== String(auth.userId) && String(task.createdBy) !== String(auth.userId)) throw ApiError.forbidden('Only the project manager or the person who created it can delete a task.');
  if (await TimeEntry.exists({ taskId: task._id })) throw ApiError.conflict('Time was logged on this task — mark it Done instead of deleting.');
  await Task.deleteOne({ _id: task._id });
  return { deleted: true };
}

// ---------------------------------------------------------------- time

async function addDayMinutes(userId, day, minutes) {
  if (minutes <= 0) {
    if (minutes < 0) await TimeDayTotal.updateOne({ userId, day }, { $inc: { minutes } });
    return;
  }
  try {
    const r = await TimeDayTotal.findOneAndUpdate({ userId, day, minutes: { $lte: PROJECT_LIMITS.minutesPerDay - minutes } }, { $inc: { minutes } }, { upsert: true, new: true });
    if (!r) throw new Error('no doc');
  } catch (err) {
    if (err.code === 11000) throw ApiError.badRequest('Validation failed', [{ field: 'minutes', message: 'That would be more than 24 hours on one day.' }]);
    throw err;
  }
}

async function loadEntry(auth, id) {
  const e = await TimeEntry.findOne({ _id: id });
  if (!e) throw ApiError.notFound('Time entry not found');
  const p = await loadProject(auth, e.projectId); // scope check
  if (String(e.userId) !== String(auth.userId) && !manages(auth)) throw ApiError.notFound('Time entry not found');
  return { e, p };
}

async function checkTask(p, taskId) {
  if (!taskId) return;
  if (!(await Task.exists({ _id: taskId, projectId: p._id }))) throw ApiError.badRequest('Validation failed', [{ field: 'taskId', message: 'Task not found in this project' }]);
}

export async function logTime(auth, projectId, { taskId, minutes, day, note, billable, userId }) {
  const p = await loadProject(auth, projectId);
  assertCanWork(auth, p);
  const who = userId && manages(auth) ? userId : auth.userId; // only managers log time for someone else
  if (String(who) !== String(auth.userId) && !(await User.exists({ _id: who, status: 'ACTIVE' }))) throw ApiError.badRequest('Team member not found');
  await checkTask(p, taskId);
  const workDay = day || (await today());
  if (workDay > (await today())) throw ApiError.badRequest('Validation failed', [{ field: 'day', message: 'You can\'t log time for a future day' }]);
  await addDayMinutes(who, workDay, minutes);
  try {
    const e = await TimeEntry.create({ projectId: p._id, taskId: taskId || null, userId: who, day: workDay, minutes, note: note || '', billable: billable ?? p.billable, rateMinor: p.hourlyRateMinor });
    return e.toJSON();
  } catch (err) {
    await addDayMinutes(who, workDay, -minutes);
    throw err;
  }
}

export async function updateTime(auth, id, data) {
  const { e, p } = await loadEntry(auth, id);
  if (e.status !== 'OPEN') throw ApiError.conflict('This time is on an invoice and can\'t be changed.');
  if (e.running) throw ApiError.conflict('Stop the timer first.');
  if (data.taskId !== undefined) await checkTask(p, data.taskId);
  const newMinutes = data.minutes ?? e.minutes;
  const newDay = data.day ?? e.day;
  if (newDay > (await today())) throw ApiError.badRequest('Validation failed', [{ field: 'day', message: 'You can\'t log time for a future day' }]);
  if (newDay !== e.day) {
    await addDayMinutes(e.userId, newDay, newMinutes);
    await addDayMinutes(e.userId, e.day, -e.minutes);
  } else if (newMinutes !== e.minutes) {
    await addDayMinutes(e.userId, e.day, newMinutes - e.minutes);
  }
  const r = await TimeEntry.findOneAndUpdate({ _id: e._id, status: 'OPEN' }, { $set: { ...data, minutes: newMinutes, day: newDay } }, { new: true });
  if (!r) {
    await addDayMinutes(e.userId, newDay, -newMinutes); // undo
    await addDayMinutes(e.userId, e.day, e.minutes);
    throw ApiError.conflict('This time was just put on an invoice.');
  }
  return r.toJSON();
}

export async function deleteTime(auth, id) {
  const { e } = await loadEntry(auth, id);
  const r = await TimeEntry.deleteOne({ _id: e._id, status: 'OPEN' });
  if (!r.deletedCount) throw ApiError.conflict('This time is on an invoice and can\'t be deleted.');
  if (!e.running) await addDayMinutes(e.userId, e.day, -e.minutes);
  return { deleted: true };
}

export async function listTime(auth, { page, limit, projectId, userId, from, to, status }) {
  const { skip } = buildPagination(page, limit);
  const filter = {};
  if (projectId) filter.projectId = (await loadProject(auth, projectId))._id;
  else if (!readsAll(auth)) filter.projectId = { $in: (await Project.find(projectScope(auth)).select('_id').limit(5000)).map((x) => x._id) };
  if (userId) filter.userId = userId === 'me' ? auth.userId : userId;
  if (!manages(auth) && !readsAll(auth)) filter.userId = auth.userId; // Sales: only their own time
  if (from || to) filter.day = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  if (status) filter.status = status;
  const [items, total, sum] = await Promise.all([
    TimeEntry.find(filter).sort({ day: -1, createdAt: -1 }).skip(skip).limit(limit).populate('userId', 'name').populate('taskId', 'title').populate('projectId', 'name'),
    TimeEntry.countDocuments(filter),
    TimeEntry.aggregate([{ $match: { ...filter, running: false } }, { $group: { _id: null, minutes: { $sum: '$minutes' } } }]),
  ]);
  return { items: items.map((x) => x.toJSON()), total, totalMinutes: sum[0]?.minutes || 0 };
}

// ---- timer (one per person)

export async function startTimer(auth, { projectId, taskId, note }) {
  const p = await loadProject(auth, projectId);
  assertCanWork(auth, p);
  await checkTask(p, taskId);
  try {
    const e = await TimeEntry.create({ projectId: p._id, taskId: taskId || null, userId: auth.userId, day: await today(), minutes: 0, note: note || '', billable: p.billable, rateMinor: p.hourlyRateMinor, running: true, startedAt: new Date() });
    return e.toJSON();
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('You already have a timer running — stop it first.');
    throw err;
  }
}

export async function currentTimer(auth) {
  const e = await TimeEntry.findOne({ userId: auth.userId, running: true }).populate('projectId', 'name').populate('taskId', 'title');
  return { timer: e ? e.toJSON() : null };
}

export async function stopTimer(auth) {
  const e = await TimeEntry.findOne({ userId: auth.userId, running: true });
  if (!e) throw ApiError.conflict('No timer is running.');
  const { minutes, capped } = timerMinutes(e.startedAt);
  const claimed = await TimeEntry.findOneAndUpdate({ _id: e._id, running: true }, { $set: { running: false, minutes, ...(capped && { note: `${e.note} [timer capped at 12 h — check it]`.trim().slice(0, 500) }) } }, { new: true });
  if (!claimed) throw ApiError.conflict('The timer was already stopped.');
  try {
    await addDayMinutes(e.userId, e.day, minutes);
  } catch (err) {
    await TimeEntry.updateOne({ _id: e._id }, { $set: { minutes: 0, note: `${e.note} [over 24 h on this day — fix the time]`.trim().slice(0, 500) } });
    throw err;
  }
  return { entry: claimed.toJSON(), capped };
}

// ---------------------------------------------------------------- bill unbilled time → DRAFT invoice

export async function invoiceTime(auth, projectId, { to } = {}) {
  const p = await loadProject(auth, projectId);
  if (!p.clientId) throw ApiError.badRequest('Link the project to a client first.');
  const settings = await salesSettings();
  if (p.currency !== settings.currency) throw ApiError.conflict(`This project is in ${p.currency}, your company currency is now ${settings.currency}.`);
  // one billing run per project at a time (updateMany alone is not atomic across documents)
  const lock = await Project.findOneAndUpdate({ _id: p._id, $or: [{ invoicingAt: null }, { invoicingAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) } }] }, { $set: { invoicingAt: new Date() } }, { new: true });
  if (!lock) throw ApiError.conflict('This project\'s time is being billed right now — try again in a moment.');
  try {
    return await billClaimedTime(auth, p, settings, to);
  } finally {
    await Project.updateOne({ _id: p._id }, { $set: { invoicingAt: null } });
  }
}

async function billClaimedTime(auth, p, settings, to) {
  const claimKey = crypto.randomUUID();
  // claim: these entries belong to THIS invoice run (two clicks can't bill the same hour twice)
  const filter = { projectId: p._id, status: 'OPEN', running: false, billable: true, minutes: { $gt: 0 }, ...(to && { day: { $lte: to } }) };
  const claimed = await TimeEntry.updateMany(filter, { $set: { status: 'INVOICING', claimKey } });
  if (!claimed.modifiedCount) throw ApiError.badRequest('There is no unbilled billable time for this project.');
  const release = () => TimeEntry.updateMany({ claimKey, status: 'INVOICING' }, { $set: { status: 'OPEN', claimKey: null } });
  try {
    const entries = await TimeEntry.find({ claimKey });
    const tasks = await Task.find({ _id: { $in: entries.map((e) => e.taskId).filter(Boolean) } }).select('title');
    const lines = timeToInvoiceLines(entries, new Map(tasks.map((t) => [String(t._id), t.title])), p.name).map((l) => ({ ...l, itemId: null, catalogPriceMinor: null, taxBp: settings.defaultTaxBp || 0 }));
    const inv = new ClientInvoice({
      title: `${p.name} — time`.slice(0, 150),
      clientId: p.clientId,
      currency: p.currency,
      footer: settings.invoiceFooter || '',
      ownerId: p.managerId,
      createdBy: auth.userId,
      updatedBy: auth.userId,
    });
    applyTotals({ ...auth, role: 'TENANT_OWNER' }, inv, lines, { type: 'NONE' }, settings); // hourly rates are set by managers
    await inv.save();
    await TimeEntry.updateMany({ claimKey, status: 'INVOICING' }, { $set: { status: 'INVOICED', invoiceId: inv._id } });
    await audit(auth, 'project.time_invoiced', 'Project', p._id, { invoiceId: String(inv._id), entries: entries.length });
    return { invoiceId: String(inv._id), entries: entries.length, totalMinor: inv.totalMinor };
  } catch (err) {
    await release();
    throw err;
  }
}

/** Called when a draft invoice is deleted or an invoice is voided → its time can be billed again. */
export async function releaseTimeForInvoice(invoiceId) {
  await TimeEntry.updateMany({ invoiceId }, { $set: { status: 'OPEN', invoiceId: null, claimKey: null } });
}
