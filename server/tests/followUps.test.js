// PHASE 19 — FOLLOW-UPS + NOTIFICATIONS: company time zone, one reminder per date, notifications only to
// people who may see the lead, everyone only reads their own notifications, opt-in daily email.
import './helpers/setupEnv.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import Plan from '../src/models/Plan.js';
import Subscription from '../src/models/Subscription.js';
import Lead from '../src/models/Lead.js';
import LeadActivity from '../src/models/LeadActivity.js';
import Notification from '../src/models/Notification.js';
import { DEFAULT_PLANS } from '../src/config/defaultPlans.js';
import { runAsSystem } from '../src/utils/tenantContext.js';
import { dayBounds } from '../src/utils/zonedTime.js';
import { setMailTransportFactory } from '../src/services/integrations/smtp.js';
import { notifyDueFollowUps, sendDailyDigests } from '../src/services/followUps/followUpService.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';
import { bearer, registerTenant, inviteAndAccept } from './helpers/authHelpers.js';

const sys = (fn) => runAsSystem('test', fn);
async function usePlan(tenantId, code) {
  const plan = await Plan.findOne({ code });
  await sys(() => Subscription.updateOne({ tenantId }, { $set: { planId: plan._id } }));
}
const mail = { sent: [] };
setMailTransportFactory(async () => ({ sendMail: async (m) => (mail.sent.push(m), { messageId: '<1@test>' }), close() {} }));

const F = '/api/v1/follow-ups';
const N = '/api/v1/notifications';
const TZ = 'Asia/Karachi';
const HOUR = 3600 * 1000;

describe('Follow-ups + notifications', () => {
  let owner, manager, sales, viewer, other;
  let n = 0;
  const mkLead = async (u, extra = {}) => (await request(app).post('/api/v1/leads').set(bearer(u.token)).send({ name: `Lead ${++n}`, phone: `0300 77700${String(n).padStart(2, '0')}`, ...extra })).body.data.lead.id;
  const notes = (u, type) => sys(() => Notification.find({ userId: u.user.id, ...(type && { type }) }));

  before(async () => {
    await startTestDb();
    await Plan.insertMany(DEFAULT_PLANS);
    owner = await registerTenant();
    await usePlan(owner.tenant.id, 'growth');
    manager = await inviteAndAccept(owner, 'MANAGER');
    sales = await inviteAndAccept(owner, 'SALES');
    viewer = await inviteAndAccept(owner, 'VIEWER');
    other = await registerTenant();
    const tz = await request(app).patch('/api/v1/settings/general').set(bearer(owner.token)).send({ timezone: TZ, digestHour: 0 });
    assert.equal(tz.status, 200, JSON.stringify(tz.body));
  });
  after(stopTestDb);

  it('company time zone: only real zone names; saved in settings', async () => {
    assert.equal((await request(app).patch('/api/v1/settings/general').set(bearer(owner.token)).send({ timezone: 'Mars/Base' })).status, 400);
    assert.equal((await request(app).patch('/api/v1/settings/general').set(bearer(owner.token)).send({ digestHour: 24 })).status, 400);
    assert.equal((await request(app).patch('/api/v1/settings/general').set(bearer(sales.token)).send({ timezone: 'UTC' })).status, 403);
    const s = await request(app).get('/api/v1/settings').set(bearer(owner.token));
    assert.equal(s.body.data.settings.general.timezone, TZ);
  });

  let salesLead;
  it('set a follow-up: future only, note saved, activity; Sales only on own leads; Viewer cannot', async () => {
    salesLead = await mkLead(sales);
    const when = new Date(Date.now() + 2 * HOUR);
    const res = await request(app).put(`${F}/${salesLead}`).set(bearer(sales.token)).send({ date: when.toISOString(), note: 'Call about the quote' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(new Date(res.body.data.followUpDate).toISOString(), when.toISOString());
    assert.equal(res.body.data.followUpNote, 'Call about the quote');
    assert.equal(res.body.data.timezone, TZ);
    assert.ok(await sys(() => LeadActivity.exists({ leadId: salesLead, type: 'FOLLOW_UP_SET' })));
    assert.equal((await request(app).put(`${F}/${salesLead}`).set(bearer(sales.token)).send({ date: new Date(Date.now() - 2 * HOUR).toISOString() })).status, 400);
    assert.equal((await request(app).put(`${F}/${salesLead}`).set(bearer(sales.token)).send({ date: 'tomorrow-ish' })).status, 400);
    const ownerLead = await mkLead(owner);
    assert.equal((await request(app).put(`${F}/${ownerLead}`).set(bearer(sales.token)).send({ date: when.toISOString() })).status, 404);
    assert.equal((await request(app).put(`${F}/${salesLead}`).set(bearer(viewer.token)).send({ date: when.toISOString() })).status, 403);
  });

  it('lists by bucket in the COMPANY\'s day (overdue / today / upcoming), counts, and "mine"', async () => {
    const now = new Date();
    const today = dayBounds(now, TZ);
    const a = await mkLead(owner);
    const b = await mkLead(owner);
    const c = await mkLead(owner);
    await sys(() => Lead.updateOne({ _id: a }, { $set: { followUpDate: new Date(today.start.getTime() - HOUR) } })); // yesterday (Karachi)
    await sys(() => Lead.updateOne({ _id: b }, { $set: { followUpDate: new Date(today.start.getTime() + 60_000) } })); // just after midnight Karachi
    await sys(() => Lead.updateOne({ _id: c }, { $set: { followUpDate: new Date(today.end.getTime() + 2 * 24 * HOUR) } }));
    const list = async (u, bucket, mine) => (await request(app).get(`${F}?bucket=${bucket}${mine ? '&mine=true' : ''}`).set(bearer(u.token))).body.data.items.map((l) => l.id);
    assert.ok((await list(owner, 'overdue')).includes(a));
    assert.ok((await list(owner, 'today')).includes(b), 'earlier today is "today", not overdue');
    assert.ok((await list(owner, 'upcoming')).includes(c));
    assert.ok(!(await list(sales, 'overdue')).includes(a), 'Sales never sees other people\'s leads');
    assert.ok(!(await list(manager, 'overdue', true)).includes(a), '"mine" = assigned to me / created by me');
    const sum = await request(app).get(`${F}/summary`).set(bearer(owner.token));
    assert.ok(sum.body.data.overdue >= 1 && sum.body.data.today >= 1 && sum.body.data.upcoming >= 1);
    assert.equal(sum.body.data.timezone, TZ);
    assert.equal((await request(app).get(`${F}?bucket=everything`).set(bearer(owner.token))).status, 400);
  });

  it('done: clears it (or schedules the next one), activity; twice → 409', async () => {
    const next = new Date(Date.now() + 3 * 24 * HOUR);
    const res = await request(app).post(`${F}/${salesLead}/done`).set(bearer(sales.token)).send({ note: 'Called — wants revised quote', next: next.toISOString() });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(new Date(res.body.data.followUpDate).toISOString(), next.toISOString());
    assert.equal(res.body.data.followUpNote, null);
    assert.ok(await sys(() => LeadActivity.exists({ leadId: salesLead, type: 'FOLLOW_UP_DONE' })));
    assert.equal((await request(app).post(`${F}/${salesLead}/done`).set(bearer(sales.token)).send({})).status, 200);
    assert.equal((await request(app).post(`${F}/${salesLead}/done`).set(bearer(sales.token)).send({})).status, 409);
  });

  it('due reminder: ONE notification to the lead\'s owner per date; new date → new reminder; closed leads skipped', async () => {
    const lead = await mkLead(sales);
    await sys(() => Lead.updateOne({ _id: lead }, { $set: { followUpDate: new Date(Date.now() - 5 * 60_000), followUpNote: 'Ask about budget' } }));
    const closed = await mkLead(sales);
    await sys(() => Lead.updateOne({ _id: closed }, { $set: { followUpDate: new Date(Date.now() - 5 * 60_000), status: 'LOST' } }));
    await notifyDueFollowUps();
    let mine = (await notes(sales, 'FOLLOW_UP_DUE')).filter((x) => String(x.leadId) === lead);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].body, 'Ask about budget');
    assert.equal(mine[0].link, `/app/leads/${lead}`);
    assert.equal((await notes(sales, 'FOLLOW_UP_DUE')).filter((x) => String(x.leadId) === closed).length, 0);
    assert.equal((await notes(owner, 'FOLLOW_UP_DUE')).filter((x) => String(x.leadId) === lead).length, 0, 'only the owner of the lead');
    await Promise.all([notifyDueFollowUps(), notifyDueFollowUps()]); // two servers at once
    mine = (await notes(sales, 'FOLLOW_UP_DUE')).filter((x) => String(x.leadId) === lead);
    assert.equal(mine.length, 1, 'never twice for the same date');
    await sys(() => Lead.updateOne({ _id: lead }, { $set: { followUpDate: new Date(Date.now() - 60_000) } }));
    await notifyDueFollowUps();
    assert.equal((await notes(sales, 'FOLLOW_UP_DUE')).filter((x) => String(x.leadId) === lead).length, 2);
  });

  it('notifications API: only my own; read one / all; someone else\'s id → 404', async () => {
    const list = await request(app).get(N).set(bearer(sales.token));
    assert.equal(list.status, 200);
    assert.ok(list.body.data.items.length >= 2);
    assert.ok(list.body.data.items.every((x) => x.userId === sales.user.id));
    assert.equal(list.body.data.items[0].dedupeKey, undefined, 'internal field hidden');
    const id = list.body.data.items[0].id;
    assert.equal((await request(app).post(`${N}/${id}/read`).set(bearer(manager.token))).status, 404, 'not yours');
    assert.equal((await request(app).post(`${N}/${id}/read`).set(bearer(other.token))).status, 404, 'other company');
    const r = await request(app).post(`${N}/${id}/read`).set(bearer(sales.token));
    assert.ok(r.body.data.notification.readAt);
    const before = (await request(app).get(`${N}/unread-count`).set(bearer(sales.token))).body.data.unread;
    assert.equal(before, list.body.data.unreadCount - 1);
    await request(app).post(`${N}/read-all`).set(bearer(sales.token));
    assert.equal((await request(app).get(`${N}/unread-count`).set(bearer(sales.token))).body.data.unread, 0);
  });

  it('lead assigned → the new owner is told (not when assigning to yourself; bulk = one notification)', async () => {
    const one = await mkLead(manager);
    await request(app).patch(`/api/v1/leads/${one}`).set(bearer(manager.token)).send({ assignedTo: sales.user.id });
    const got = (await notes(sales, 'LEAD_ASSIGNED')).filter((x) => String(x.leadId) === one);
    assert.equal(got.length, 1);
    assert.match(got[0].title, /^New lead for you: Lead \d+$/);
    const mineLead = await mkLead(manager);
    await request(app).patch(`/api/v1/leads/${mineLead}`).set(bearer(manager.token)).send({ assignedTo: manager.user.id });
    assert.equal((await notes(manager, 'LEAD_ASSIGNED')).length, 0);
    const ids = [await mkLead(manager), await mkLead(manager), await mkLead(manager)];
    const before = (await notes(sales, 'LEAD_ASSIGNED')).length;
    const bulk = await request(app).post('/api/v1/leads/bulk').set(bearer(manager.token)).send({ ids, action: 'assign', value: sales.user.id });
    assert.equal(bulk.status, 200, JSON.stringify(bulk.body));
    const after = await notes(sales, 'LEAD_ASSIGNED');
    assert.equal(after.length, before + 1);
    assert.equal(after.at(-1).title, '3 leads were assigned to you');
  });

  it('muted types are not created; preferences validated', async () => {
    const p = await request(app).patch(`${N}/preferences`).set(bearer(sales.token)).send({ muted: ['LEAD_ASSIGNED'] });
    assert.equal(p.status, 200);
    assert.deepEqual(p.body.data.muted, ['LEAD_ASSIGNED']);
    assert.equal((await request(app).patch(`${N}/preferences`).set(bearer(sales.token)).send({ muted: ['HACK'] })).status, 400);
    assert.equal((await request(app).patch(`${N}/preferences`).set(bearer(sales.token)).send({ userId: manager.user.id, emailDigest: true })).status, 400, 'cannot change someone else');
    const before = (await notes(sales, 'LEAD_ASSIGNED')).length;
    const l = await mkLead(manager);
    await request(app).patch(`/api/v1/leads/${l}`).set(bearer(manager.token)).send({ assignedTo: sales.user.id });
    assert.equal((await notes(sales, 'LEAD_ASSIGNED')).length, before);
    await request(app).patch(`${N}/preferences`).set(bearer(sales.token)).send({ muted: [] });
  });

  it('draft approved / rejected → the person who wrote it is told', async () => {
    const lead = await mkLead(sales);
    const mk = async () => (await request(app).post('/api/v1/messages/manual').set(bearer(sales.token)).send({ leadId: lead, channel: 'LINKEDIN', body: 'Hi, we build websites for shops. Interested?' })).body.data.message.id;
    const d1 = await mk();
    await request(app).post(`/api/v1/messages/${d1}/approve`).set(bearer(manager.token)).send({});
    assert.equal((await notes(sales, 'MESSAGE_APPROVED')).length, 1);
    await request(app).post(`/api/v1/messages/${d1}/mark-sent`).set(bearer(sales.token)).send({});
    const d2 = await mk();
    await request(app).post(`/api/v1/messages/${d2}/reject`).set(bearer(manager.token)).send({ reason: 'Too pushy' });
    const rej = await notes(sales, 'MESSAGE_REJECTED');
    assert.equal(rej.length, 1);
    assert.equal(rej[0].body, 'Too pushy');
  });

  it('daily email (opt-in): from the company mailbox, only MY due follow-ups, once per day; none due → no email', async () => {
    assert.equal((await request(app).put('/api/v1/integrations/SMTP').set(bearer(owner.token)).send({ credentials: { password: 'app-password-123' }, config: { host: 'smtp.example.com', port: '587', username: 'hello@techbridge.pk', fromEmail: 'hello@techbridge.pk', fromName: 'TechBridge' } })).status, 200);
    await request(app).patch(`${N}/preferences`).set(bearer(sales.token)).send({ emailDigest: true });
    await request(app).patch(`${N}/preferences`).set(bearer(viewer.token)).send({ emailDigest: true }); // nothing due for the viewer
    const lead = await mkLead(sales, { name: '<b>Bold Bakery</b>' });
    await sys(() => Lead.updateOne({ _id: lead }, { $set: { followUpDate: new Date(Date.now() - HOUR), followUpNote: 'Send revised quote' } }));
    mail.sent = [];
    const n1 = await sendDailyDigests();
    assert.equal(n1, 1);
    assert.equal(mail.sent.length, 1);
    const m = mail.sent[0];
    assert.equal(m.to, sales.email);
    assert.equal(m.from, '"TechBridge" <hello@techbridge.pk>');
    assert.match(m.html, /&lt;b&gt;Bold Bakery&lt;\/b&gt;/);
    assert.match(m.subject, /^2 follow-ups today/, 'only the Sales person\'s own due leads (not the owner\'s)');
    assert.match(m.text, /Send revised quote/);
    assert.equal(await sendDailyDigests(), 0, 'once per day');
    assert.equal(mail.sent.length, 1);
  });

  it('other company sees none of our follow-ups or notifications', async () => {
    assert.equal((await request(app).get(`${F}?bucket=overdue`).set(bearer(other.token))).body.data.items.length, 0);
    assert.equal((await request(app).get(N).set(bearer(other.token))).body.data.items.length, 0);
    assert.equal((await request(app).get(`${F}/${salesLead}`).set(bearer(other.token))).status, 404);
  });
});
