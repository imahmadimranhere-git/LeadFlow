// PHASE 22 — PROJECTS, TASKS, TIME: membership-based access, 24 h/day limit (atomic), one timer per person,
// invoiced time is locked and can't be billed twice, tenant isolation.
import './helpers/setupEnv.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import Plan from '../src/models/Plan.js';
import Subscription from '../src/models/Subscription.js';
import TimeEntry from '../src/models/TimeEntry.js';
import Notification from '../src/models/Notification.js';
import { DEFAULT_PLANS } from '../src/config/defaultPlans.js';
import { runAsSystem } from '../src/utils/tenantContext.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';
import { bearer, registerTenant, inviteAndAccept } from './helpers/authHelpers.js';

const sys = (fn) => runAsSystem('test', fn);
async function usePlan(tenantId, code) {
  const plan = await Plan.findOne({ code });
  await sys(() => Subscription.updateOne({ tenantId }, { $set: { planId: plan._id } }));
}
const PR = '/api/v1/projects';
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

describe('Projects, tasks, time', () => {
  let owner, manager, sales, sales2, viewer, other, noProj;
  let clientId, projectId, taskId;
  const post = (u, url, body) => request(app).post(url).set(bearer(u.token)).send(body);
  const patch = (u, url, body) => request(app).patch(url).set(bearer(u.token)).send(body);
  const get = (u, url) => request(app).get(url).set(bearer(u.token));
  const del = (u, url) => request(app).delete(url).set(bearer(u.token));

  before(async () => {
    await startTestDb();
    const growth = DEFAULT_PLANS.find((p) => p.code === 'growth');
    await Plan.insertMany([...DEFAULT_PLANS, { ...growth, code: 'no-proj', name: 'No projects', erpModules: ['SALES'] }]);
    owner = await registerTenant();
    await usePlan(owner.tenant.id, 'growth');
    manager = await inviteAndAccept(owner, 'MANAGER');
    sales = await inviteAndAccept(owner, 'SALES');
    sales2 = await inviteAndAccept(owner, 'SALES');
    viewer = await inviteAndAccept(owner, 'VIEWER');
    other = await registerTenant();
    await usePlan(other.tenant.id, 'growth');
    noProj = await registerTenant();
    await usePlan(noProj.tenant.id, 'no-proj');
    await patch(owner, '/api/v1/settings/sales', { currency: 'PKR' });
    clientId = (await post(owner, '/api/v1/clients', { name: 'Ali Bakery' })).body.data.client.id;
  });
  after(stopTestDb);

  it('plan module PROJECTS (402); only projects:manage creates; members must be our own team', async () => {
    assert.equal((await get(noProj, PR)).status, 402);
    assert.equal((await post(sales, PR, { name: 'X' })).status, 403);
    assert.equal((await post(manager, PR, { name: 'X', members: [other.user.id] })).status, 400, 'a user from another company');
    const r = await post(manager, PR, { name: 'Ali Bakery website', clientId, members: [sales.user.id], hourlyRate: '5000', budgetHours: 10 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    projectId = r.body.data.project.id;
    assert.equal(r.body.data.project.hourlyRateMinor, 500000);
    assert.equal(r.body.data.project.budgetMinutes, 600);
    assert.equal(r.body.data.project.currency, 'PKR');
    assert.ok(r.body.data.project.members.includes(manager.user.id), 'the manager is a member too');
  });

  it('visibility: members see the project, other Sales people get 404; Viewer reads', async () => {
    assert.equal((await get(sales, `${PR}/${projectId}`)).status, 200);
    assert.equal((await get(sales2, `${PR}/${projectId}`)).status, 404);
    assert.equal((await get(sales2, PR)).body.data.items.length, 0);
    assert.equal((await get(viewer, `${PR}/${projectId}`)).status, 200);
    assert.equal((await get(other, `${PR}/${projectId}`)).status, 404);
  });

  it('tasks: members add/move; assignee must be a member (notified); milestones only by the project manager', async () => {
    const t = await post(manager, `${PR}/${projectId}/tasks`, { title: 'Homepage design', assigneeId: sales.user.id, estimate: '4h' });
    assert.equal(t.status, 201, JSON.stringify(t.body));
    taskId = t.body.data.task.id;
    assert.equal(t.body.data.task.estimateMinutes, 240);
    assert.equal(await sys(() => Notification.countDocuments({ userId: sales.user.id, type: 'TASK_ASSIGNED' })), 1);
    assert.equal((await post(manager, `${PR}/${projectId}/tasks`, { title: 'x', assigneeId: sales2.user.id })).status, 400, 'not a member');
    assert.equal((await post(sales2, `${PR}/${projectId}/tasks`, { title: 'x' })).status, 404);
    assert.equal((await post(viewer, `${PR}/${projectId}/tasks`, { title: 'x' })).status, 403);
    const own = await post(sales, `${PR}/${projectId}/tasks`, { title: 'Collect photos' });
    assert.equal(own.status, 201);
    const moved = await patch(sales, `/api/v1/tasks/${taskId}`, { status: 'DONE' });
    assert.ok(moved.body.data.task.completedAt);
    await patch(sales, `/api/v1/tasks/${taskId}`, { status: 'IN_PROGRESS' });
    assert.equal((await post(sales, `${PR}/${projectId}/milestones`, { name: 'Design approved' })).status, 403);
    const ms = await post(manager, `${PR}/${projectId}/milestones`, { name: 'Design approved', dueDate: new Date(Date.now() + 7 * 86400000).toISOString() });
    assert.equal(ms.status, 201);
    const msId = ms.body.data.project.milestones[0].id;
    assert.equal((await patch(manager, `/api/v1/tasks/${taskId}`, { milestoneId: msId })).status, 200);
    assert.equal((await patch(manager, `/api/v1/tasks/${taskId}`, { milestoneId: '0'.repeat(24) })).status, 400);
    assert.equal((await del(sales, `/api/v1/tasks/${taskId}`)).status, 403, 'not the creator, not the manager');
  });

  it('time: own time only, no future days, max 24 h per person per day (even with two requests at once)', async () => {
    const r = await post(sales, `${PR}/${projectId}/time`, { taskId, time: '1:30', note: 'Wireframes' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.entry.minutes, 90);
    assert.equal(r.body.data.entry.rateMinor, 500000);
    assert.equal((await post(sales, `${PR}/${projectId}/time`, { time: '1h', day: '2099-01-01' })).status, 400);
    assert.equal((await post(sales, `${PR}/${projectId}/time`, { time: '25:00' })).status, 400);
    assert.equal((await post(viewer, `${PR}/${projectId}/time`, { time: '1h' })).status, 403);
    assert.equal((await post(sales2, `${PR}/${projectId}/time`, { time: '1h' })).status, 404);
    const d = daysAgo(3);
    const [a, b] = await Promise.all([post(sales, `${PR}/${projectId}/time`, { time: '13h', day: d }), post(sales, `${PR}/${projectId}/time`, { time: '13h', day: d })]);
    assert.deepEqual([a.status, b.status].sort(), [201, 400], '26 h in one day is impossible');
    const sum = await sys(() => TimeEntry.aggregate([{ $match: { userId: TimeEntry.base.Types.ObjectId.createFromHexString(sales.user.id), day: d } }, { $group: { _id: null, m: { $sum: '$minutes' } } }]));
    assert.equal(sum[0].m, 780);
    const mine = (await get(manager, `/api/v1/time?projectId=${projectId}`)).body.data.items.find((x) => x.minutes === 90);
    const mgrEntry = (await post(manager, `${PR}/${projectId}/time`, { time: '30m', day: daysAgo(1) })).body.data.entry;
    assert.equal((await patch(sales, `/api/v1/time/${mgrEntry.id}`, { time: '10h' })).status, 404, 'not your entry');
    assert.equal((await patch(manager, `/api/v1/time/${mine.id}`, { note: 'Wireframes v2' })).status, 200, 'managers can fix anyone\'s time');
  });

  it('timer: one per person; stop saves whole minutes', async () => {
    const s = await post(sales, '/api/v1/time/timer/start', { projectId, taskId });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    assert.equal((await post(sales, '/api/v1/time/timer/start', { projectId })).status, 409);
    assert.equal((await get(sales, '/api/v1/time/timer')).body.data.timer.running, true);
    const stop = await post(sales, '/api/v1/time/timer/stop', {});
    assert.equal(stop.status, 200);
    assert.ok(stop.body.data.entry.minutes >= 1);
    assert.equal((await post(sales, '/api/v1/time/timer/stop', {})).status, 409);
  });

  let invoiceId;
  it('bill time: draft invoice with hours × rate; billed time locked; two clicks can\'t bill the same hour twice', async () => {
    assert.equal((await post(sales, `${PR}/${projectId}/invoice-time`, {})).status, 403, 'money permission');
    const [a, b] = await Promise.all([post(manager, `${PR}/${projectId}/invoice-time`, {}), post(owner, `${PR}/${projectId}/invoice-time`, {})]);
    const st = [a.status, b.status].sort();
    assert.equal(st[0], 201, JSON.stringify([a.body, b.body]));
    assert.ok([400, 409].includes(st[1]), 'the second click finds nothing left (400) or the run still busy (409)');
    const ok = a.status === 201 ? a : b;
    invoiceId = ok.body.data.invoiceId;
    const inv = (await get(manager, `/api/v1/invoices/${invoiceId}`)).body.data.invoice;
    assert.equal(inv.status, 'DRAFT');
    assert.ok(inv.lines.every((l) => l.unit === 'hour'));
    const open = await sys(() => TimeEntry.countDocuments({ projectId, status: 'OPEN', billable: true, running: false }));
    assert.equal(open, 0, 'everything billable is on the invoice');
    const billed = await sys(() => TimeEntry.findOne({ invoiceId }));
    assert.equal((await patch(manager, `/api/v1/time/${billed.id}`, { note: 'x' })).status, 409, 'locked');
    assert.equal((await del(manager, `/api/v1/time/${billed.id}`)).status, 409);
    assert.equal((await post(manager, `${PR}/${projectId}/invoice-time`, {})).status, 400, 'nothing left to bill');
  });

  it('deleting the draft invoice releases the time so it can be billed again', async () => {
    assert.equal((await del(manager, `/api/v1/invoices/${invoiceId}`)).status, 200);
    assert.equal(await sys(() => TimeEntry.countDocuments({ invoiceId })), 0);
    assert.equal((await post(manager, `${PR}/${projectId}/invoice-time`, {})).status, 201);
  });

  it('progress numbers; completed project → no more time or tasks until reopened', async () => {
    const g = await get(manager, `${PR}/${projectId}`);
    assert.equal(g.body.data.progress.tasksTotal, 2);
    assert.ok(g.body.data.progress.minutesLogged >= 90 + 780 + 30);
    assert.equal(g.body.data.progress.overBudget, true, '10 h budget');
    assert.equal(g.body.data.can.manage, true);
    assert.equal((await patch(sales, `${PR}/${projectId}`, { status: 'COMPLETED' })).status, 403, 'only the project manager');
    await patch(manager, `${PR}/${projectId}`, { status: 'COMPLETED' });
    assert.equal((await post(sales, `${PR}/${projectId}/time`, { time: '1h' })).status, 409);
    assert.equal((await post(sales, `${PR}/${projectId}/tasks`, { title: 'late' })).status, 409);
    await patch(manager, `${PR}/${projectId}`, { status: 'ACTIVE' });
  });

  it('project from an accepted quote: client + budget, once only', async () => {
    const q = (await post(owner, '/api/v1/quotes', { clientId, title: 'Shop website', lines: [{ description: 'Website', quantity: '1', unitPrice: '80000' }] })).body.data.quote;
    assert.equal((await post(manager, `${PR}/from-quote/${q.id}`)).status, 409, 'not accepted yet');
    await post(owner, `/api/v1/quotes/${q.id}/status`, { status: 'SENT' });
    await post(owner, `/api/v1/quotes/${q.id}/status`, { status: 'ACCEPTED' });
    const r = await post(manager, `${PR}/from-quote/${q.id}`);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.project.budgetMinor, 8000000);
    assert.equal((await post(manager, `${PR}/from-quote/${q.id}`)).status, 409);
  });

  it('isolation: other company can\'t see tasks or time, or log on our project', async () => {
    assert.equal((await get(other, `${PR}/${projectId}/tasks`)).status, 404);
    assert.equal((await patch(other, `/api/v1/tasks/${taskId}`, { status: 'DONE' })).status, 404);
    assert.equal((await post(other, `${PR}/${projectId}/time`, { time: '1h' })).status, 404);
    assert.equal((await get(other, '/api/v1/time')).body.data.items.length, 0);
    assert.equal((await get(sales2, '/api/v1/time')).body.data.items.length, 0, 'Sales sees only their own time');
  });
});
