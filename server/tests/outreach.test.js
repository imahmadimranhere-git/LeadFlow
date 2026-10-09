// PHASE 17 — OUTREACH: only approved text is sent, DNC/consent enforced at send time, one send per message,
// unsubscribe in every email. The mail server is replaced by a fake transport.
import './helpers/setupEnv.js';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import Plan from '../src/models/Plan.js';
import Subscription from '../src/models/Subscription.js';
import Lead from '../src/models/Lead.js';
import LeadActivity from '../src/models/LeadActivity.js';
import OutreachMessage from '../src/models/OutreachMessage.js';
import DoNotContact from '../src/models/DoNotContact.js';
import { DEFAULT_PLANS } from '../src/config/defaultPlans.js';
import { runAsSystem } from '../src/utils/tenantContext.js';
import { setMailTransportFactory } from '../src/services/integrations/smtp.js';
import { recoverStuckSending } from '../src/services/outreach/outreachService.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';
import { bearer, registerTenant, inviteAndAccept } from './helpers/authHelpers.js';

const sys = (fn) => runAsSystem('test', fn);
async function usePlan(tenantId, code) {
  const plan = await Plan.findOne({ code });
  await sys(() => Subscription.updateOne({ tenantId }, { $set: { planId: plan._id } }));
}

const mail = { sent: [], failWith: null, delayMs: 0 };
setMailTransportFactory(async () => ({
  sendMail: async (m) => {
    if (mail.delayMs) await new Promise((r) => setTimeout(r, mail.delayMs));
    if (mail.failWith) throw Object.assign(new Error('smtp'), { code: mail.failWith });
    mail.sent.push(m);
    return { messageId: `<${mail.sent.length}@test>` };
  },
  close() {},
}));

const M = '/api/v1/messages';
describe('Outreach', () => {
  let owner, manager, sales, viewer, other;
  let n = 0;
  const mkLead = async (u, extra = {}) => (await request(app).post('/api/v1/leads').set(bearer(u.token)).send({ name: `Lead ${++n}`, email: `lead${n}@shop${n}.pk`, phone: `0300 55500${String(n).padStart(2, '0')}`, ...extra })).body.data.lead.id;
  const approved = async (author, leadId, channel = 'EMAIL', approver = manager) => {
    const d = await request(app).post(`${M}/manual`).set(bearer(author.token)).send({ leadId, channel, ...(channel === 'EMAIL' && { subject: 'Hello' }), body: 'Hi, we build websites for shops like yours. Interested?' });
    assert.equal(d.status, 201, JSON.stringify(d.body));
    const a = await request(app).post(`${M}/${d.body.data.message.id}/approve`).set(bearer(approver.token)).send({});
    assert.equal(a.status, 200, JSON.stringify(a.body));
    return d.body.data.message.id;
  };
  const send = (u, id) => request(app).post(`${M}/${id}/send-email`).set(bearer(u.token)).send();

  before(async () => {
    await startTestDb();
    await Plan.insertMany(DEFAULT_PLANS);
    owner = await registerTenant();
    await usePlan(owner.tenant.id, 'growth');
    manager = await inviteAndAccept(owner, 'MANAGER');
    sales = await inviteAndAccept(owner, 'SALES');
    viewer = await inviteAndAccept(owner, 'VIEWER');
    other = await registerTenant();
    const smtp = await request(app).put('/api/v1/integrations/SMTP').set(bearer(owner.token)).send({ credentials: { password: 'app-password-123' }, config: { host: 'smtp.example.com', port: '587', username: 'hello@techbridge.pk', fromEmail: 'hello@techbridge.pk', fromName: 'TechBridge' } });
    assert.equal(smtp.status, 200, JSON.stringify(smtp.body));
  });
  after(stopTestDb);
  beforeEach(() => {
    mail.failWith = null;
    mail.delayMs = 0;
  });

  let leadA;
  let firstId;
  it('send: the APPROVED text goes out through YOUR mailbox, with unsubscribe link + headers; lead becomes CONTACTED', async () => {
    leadA = await mkLead(owner);
    firstId = await approved(owner, leadA);
    const res = await send(owner, firstId);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const m = res.body.data.message;
    assert.equal(m.status, 'SENT');
    assert.equal(m.sentVia, 'SMTP');
    assert.match(m.sentTo, /^lead\d+@shop\d+\.pk$/);
    assert.equal(m.providerMessageId, undefined, 'internal id not exposed');
    const sent = mail.sent.at(-1);
    assert.equal(sent.to, m.sentTo);
    assert.equal(sent.from, '"TechBridge" <hello@techbridge.pk>');
    assert.match(sent.text, /^Hi, we build websites/);
    assert.match(sent.headers['List-Unsubscribe'], /^<http:\/\/localhost:5099\/api\/v1\/unsubscribe\/[\w-]+\.[\w-]{43}>$/);
    const lead = await sys(() => Lead.findById(leadA));
    assert.equal(lead.status, 'CONTACTED');
    assert.ok(await sys(() => LeadActivity.exists({ leadId: leadA, type: 'MESSAGE_SENT' })));
  });

  it('one send per message: again → 409; two clicks at once → one email', async () => {
    assert.equal((await send(owner, firstId)).status, 409);
    const id = await approved(owner, await mkLead(owner));
    const before = mail.sent.length;
    mail.delayMs = 80;
    const [a, b] = await Promise.all([send(owner, id), send(manager, id)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal(mail.sent.length, before + 1);
  });

  it('only approved EMAIL messages; other channels are sent by hand; Viewer cannot send', async () => {
    const lead = await mkLead(owner);
    const d = await request(app).post(`${M}/manual`).set(bearer(owner.token)).send({ leadId: lead, channel: 'EMAIL', subject: 'x', body: 'Not approved yet, hello there' });
    assert.equal((await send(owner, d.body.data.message.id)).status, 409);
    const li = await approved(owner, lead, 'LINKEDIN');
    assert.equal((await send(owner, li)).status, 400);
    assert.equal((await send(viewer, firstId)).status, 403);
  });

  it('do-not-contact is enforced AT SEND TIME: lead flag, DNC list entry (even if the flag is stale), withdrawn consent', async () => {
    const l1 = await mkLead(owner);
    const m1 = await approved(owner, l1);
    await sys(() => Lead.updateOne({ _id: l1 }, { $set: { doNotContact: true } }));
    let res = await send(owner, m1);
    assert.equal(res.status, 409);
    assert.equal(res.body.errors[0].code, 'DO_NOT_CONTACT');

    const l2 = await mkLead(owner);
    const m2 = await approved(owner, l2);
    const email = (await sys(() => Lead.findById(l2))).email;
    await sys(() => DoNotContact.create({ tenantId: owner.tenant.id, type: 'EMAIL', value: email }));
    res = await send(owner, m2);
    assert.equal(res.status, 409);
    assert.equal((await sys(() => Lead.findById(l2))).doNotContact, true, 'stale flag fixed');

    const l3 = await mkLead(owner);
    const m3 = await approved(owner, l3);
    await request(app).patch(`/api/v1/leads/${l3}`).set(bearer(owner.token)).send({ compliance: { consentStatus: 'WITHDRAWN' } });
    res = await send(owner, m3);
    assert.equal(res.status, 409);
    assert.equal(mail.sent.filter((s) => [email].includes(s.to)).length, 0);
  });

  it('mail server error → SEND_FAILED with a clear reason; retry works', async () => {
    const id = await approved(owner, await mkLead(owner));
    mail.failWith = 'EAUTH';
    const res = await send(owner, id);
    assert.equal(res.status, 502);
    assert.match(res.body.message, /rejected the login/);
    assert.equal((await sys(() => OutreachMessage.findById(id))).status, 'SEND_FAILED');
    mail.failWith = null;
    assert.equal((await send(owner, id)).status, 200);
    assert.equal((await sys(() => OutreachMessage.findById(id))).sendAttempts, 2);
  });

  it('not the same lead twice in 24 h; daily email limit from settings', async () => {
    const second = await approved(owner, leadA, 'EMAIL');
    const res = await send(owner, second);
    assert.equal(res.status, 409);
    assert.equal(res.body.errors[0].code, 'TOO_SOON');
    await request(app).patch('/api/v1/settings/outreach').set(bearer(owner.token)).send({ dailyEmailLimit: 1 });
    const id = await approved(owner, await mkLead(owner));
    assert.equal((await send(owner, id)).status, 429);
    await request(app).patch('/api/v1/settings/outreach').set(bearer(owner.token)).send({ dailyEmailLimit: 100 });
  });

  it('a sent message is a record: cannot be edited or deleted', async () => {
    assert.equal((await request(app).patch(`${M}/${firstId}`).set(bearer(owner.token)).send({ body: 'changed after sending' })).status, 409);
    assert.equal((await request(app).delete(`${M}/${firstId}`).set(bearer(owner.token))).status, 409);
  });

  it('manual channels: open profile / WhatsApp link → "Mark as sent" → replied → follow-up → closed (lead status follows)', async () => {
    const lead = await mkLead(owner, { socialProfileUrl: 'https://www.linkedin.com/in/someone/' });
    const li = await approved(owner, lead, 'LINKEDIN');
    const opts = await request(app).get(`${M}/${li}/send-options`).set(bearer(owner.token));
    assert.equal(opts.body.data.profileUrl, 'https://www.linkedin.com/in/someone/');
    assert.equal((await request(app).post(`${M}/${li}/mark-replied`).set(bearer(owner.token)).send({})).status, 409, 'not sent yet');
    let r = await request(app).post(`${M}/${li}/mark-sent`).set(bearer(owner.token)).send({ note: 'Sent from my LinkedIn' });
    assert.equal(r.body.data.message.status, 'SENT');
    assert.equal(r.body.data.message.sentVia, 'MANUAL');
    r = await request(app).post(`${M}/${li}/mark-replied`).set(bearer(owner.token)).send({ note: 'Asked for prices' });
    assert.equal(r.body.data.message.status, 'REPLIED');
    assert.equal((await sys(() => Lead.findById(lead))).status, 'REPLIED');
    assert.equal((await request(app).post(`${M}/${li}/follow-up`).set(bearer(owner.token)).send({ date: '2020-01-01' })).status, 400);
    const when = new Date(Date.now() + 3 * 86400_000).toISOString();
    r = await request(app).post(`${M}/${li}/follow-up`).set(bearer(owner.token)).send({ date: when });
    assert.equal(r.body.data.message.status, 'FOLLOW_UP');
    assert.equal((await sys(() => Lead.findById(lead))).followUpDate.toISOString(), when);
    r = await request(app).post(`${M}/${li}/close`).set(bearer(owner.token)).send({ note: 'Not now' });
    assert.equal(r.body.data.message.status, 'CLOSED');
    assert.equal((await request(app).post(`${M}/${li}/mark-replied`).set(bearer(owner.token)).send({})).status, 409);

    const wa = await approved(owner, lead, 'WHATSAPP');
    const w = await request(app).get(`${M}/${wa}/send-options`).set(bearer(owner.token));
    assert.match(w.body.data.whatsappUrl, /^https:\/\/wa\.me\/\d{10,15}\?text=Hi%2C%20we%20build/);
  });

  it('UNSUBSCRIBE: GET only shows a page (link scanners must not unsubscribe); POST unsubscribes; tampered link refused; then sending is blocked', async () => {
    const url = new URL(mail.sent[0].headers['List-Unsubscribe'].slice(1, -1));
    const page = await request(app).get(url.pathname);
    assert.equal(page.status, 200);
    assert.match(page.text, /<form method="post"/);
    const lead0 = await sys(() => Lead.findOne({ email: mail.sent[0].to }));
    assert.equal(lead0.doNotContact, false, 'GET changed nothing');

    // change the signed part (first character of the payload) → signature no longer matches
    const bad = url.pathname.replace(/\/unsubscribe\/(.)/, (_, c) => `/unsubscribe/${c === 'e' ? 'f' : 'e'}`);
    assert.equal((await request(app).post(bad).type('form').send('List-Unsubscribe=One-Click')).status, 400);

    const ok = await request(app).post(url.pathname).type('form').send('List-Unsubscribe=One-Click');
    assert.equal(ok.status, 200);
    assert.match(ok.text, /You are unsubscribed/);
    const lead = await sys(() => Lead.findById(lead0._id));
    assert.equal(lead.doNotContact, true);
    assert.equal(lead.compliance.consentStatus, 'WITHDRAWN');
    assert.ok(lead.compliance.optOutAt);
    assert.ok(await sys(() => DoNotContact.exists({ tenantId: owner.tenant.id, type: 'EMAIL', value: mail.sent[0].to })));
    assert.ok(await sys(() => LeadActivity.exists({ leadId: lead._id, type: 'UNSUBSCRIBED' })));
    assert.equal((await request(app).post(url.pathname).type('form').send('')).status, 200, 'twice is fine');
  });

  it('a send interrupted by a crash is never retried automatically — a person must check', async () => {
    const id = await approved(owner, await mkLead(owner));
    await sys(() => OutreachMessage.updateOne({ _id: id }, { $set: { status: 'SENDING', sendingStartedAt: new Date(Date.now() - 15 * 60 * 1000) } }));
    assert.equal(await recoverStuckSending(), 1);
    const m = await sys(() => OutreachMessage.findById(id));
    assert.equal(m.status, 'SEND_FAILED');
    assert.match(m.sendError, /check your mailbox/);
  });

  it('Sales sends their own approved messages, not a colleague\'s; another company → 404; no SMTP → clear 400', async () => {
    const own = await mkLead(sales);
    const ownMsg = await approved(sales, own);
    assert.equal((await send(sales, ownMsg)).status, 200);
    const ownerMsg = await approved(owner, await mkLead(owner));
    assert.equal((await send(sales, ownerMsg)).status, 404);
    assert.equal((await send(other, ownerMsg)).status, 404);

    const ol = await mkLead(other);
    const om = await approved(other, ol, 'EMAIL', other);
    const res = await send(other, om);
    assert.equal(res.status, 400);
    assert.equal(res.body.errors[0].code, 'NOT_CONNECTED');
  });
});
