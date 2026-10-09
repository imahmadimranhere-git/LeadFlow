// PHASE 16 — LOCAL BUSINESS (Google Places, live). Google is replaced by a fake transport.
import './helpers/setupEnv.js';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import Plan from '../src/models/Plan.js';
import Subscription from '../src/models/Subscription.js';
import Lead from '../src/models/Lead.js';
import UsageCounter from '../src/models/UsageCounter.js';
import { DEFAULT_PLANS } from '../src/config/defaultPlans.js';
import { runAsSystem } from '../src/utils/tenantContext.js';
import { setPlacesTransport } from '../src/services/leads/localBusiness/placesClient.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';
import { bearer, registerTenant, inviteAndAccept } from './helpers/authHelpers.js';

const sys = (fn) => runAsSystem('test', fn);
async function usePlan(tenantId, code) {
  const plan = await Plan.findOne({ code });
  await sys(() => Subscription.updateOne({ tenantId }, { $set: { planId: plan._id } }));
}
const KEY = `AIza${'x'.repeat(35)}`;
const fake = { calls: [], next: null };
const PLACES = [
  { id: 'ChIJplace000001', displayName: { text: 'Smile Dental Clinic' }, formattedAddress: 'F-7, Islamabad', googleMapsUri: 'https://maps.google.com/?cid=1', websiteUri: 'https://smiledental.pk', nationalPhoneNumber: '051 1234567', rating: 4.6, userRatingCount: 120, businessStatus: 'OPERATIONAL', types: ['dentist', 'health'] },
  { id: 'ChIJplace000002', displayName: { text: 'City Dentists' }, googleMapsUri: 'javascript:alert(1)', websiteUri: 'ftp://x' },
  { id: 'bad id!', displayName: { text: 'Broken' } },
];
setPlacesTransport(async (url, req) => {
  fake.calls.push({ url, ...req });
  return fake.next || { status: 200, json: () => ({ places: PLACES, nextPageToken: 'next-1' }) };
});

describe('Local business discovery (Google Places)', () => {
  let owner, sales, other, free;
  const S = '/api/v1/discovery/local/search';
  const I = '/api/v1/discovery/local/import';
  before(async () => {
    await startTestDb();
    await Plan.insertMany(DEFAULT_PLANS);
    owner = await registerTenant();
    await usePlan(owner.tenant.id, 'growth');
    sales = await inviteAndAccept(owner, 'SALES');
    other = await registerTenant();
    await usePlan(other.tenant.id, 'growth');
    free = await registerTenant(); // free trial: no LOCAL_BUSINESS
  });
  after(stopTestDb);
  beforeEach(() => {
    fake.calls = [];
    fake.next = null;
  });

  it('plan without local business → 402; no key connected → clear 400', async () => {
    assert.equal((await request(app).post(S).set(bearer(free.token)).send({ query: 'Dentist in Islamabad' })).status, 402);
    const res = await request(app).post(S).set(bearer(owner.token)).send({ query: 'Dentist in Islamabad' });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /Google Places/);
    assert.equal(fake.calls.length, 0);
  });

  it('search: official API, key only in a header, limited field mask; results shown, NOT stored; 1 search from the plan', async () => {
    assert.equal((await request(app).put('/api/v1/integrations/GOOGLE_PLACES').set(bearer(owner.token)).send({ credentials: { apiKey: KEY } })).status, 200);
    const leadsBefore = await sys(() => Lead.countDocuments({ tenantId: owner.tenant.id }));
    const res = await request(app).post(S).set(bearer(owner.token)).send({ query: 'Dentist in Islamabad', regionCode: 'pk' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const call = fake.calls[0];
    assert.equal(call.url, 'https://places.googleapis.com/v1/places:searchText');
    assert.equal(call.headers['x-goog-api-key'], KEY);
    assert.match(call.headers['x-goog-fieldmask'], /places\.id/);
    assert.deepEqual(call.body, { textQuery: 'Dentist in Islamabad', pageSize: 20, languageCode: 'en', regionCode: 'PK' });
    const r = res.body.data;
    assert.equal(r.attribution, 'Google Maps');
    assert.equal(r.nextPageToken, 'next-1');
    assert.equal(r.results.length, 2, 'invalid place id dropped');
    assert.equal(r.results[0].phone, '051 1234567');
    assert.equal(r.results[1].googleMapsUri, 'https://www.google.com/maps/place/?q=place_id:ChIJplace000002', 'javascript: link replaced');
    assert.equal(r.results[1].websiteUri, null);
    assert.equal(await sys(() => Lead.countDocuments({ tenantId: owner.tenant.id })), leadsBefore, 'nothing saved');
    assert.equal((await sys(() => UsageCounter.findOne({ tenantId: owner.tenant.id, metric: 'discoverySearches' }))).count, 1);
  });

  it('import: lead = place ID + name you confirm + Maps link; Google phone/website/address are NOT copied', async () => {
    const res = await request(app).post(I).set(bearer(sales.token)).send({ query: 'Dentist in Islamabad', city: 'Islamabad', places: [{ placeId: 'ChIJplace000001', name: 'Smile Dental Clinic' }] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.imported, 1);
    const lead = await sys(() => Lead.findOne({ tenantId: owner.tenant.id, placeId: 'ChIJplace000001' }));
    assert.equal(lead.name, 'Smile Dental Clinic');
    assert.equal(lead.source, 'LOCAL_BUSINESS');
    assert.equal(lead.sourceUrl, 'https://www.google.com/maps/place/?q=place_id:ChIJplace000001');
    assert.equal(lead.city, 'Islamabad');
    assert.equal(lead.phone, null);
    assert.equal(lead.website, null);
    assert.equal(String(lead.assignedTo), sales.user.id);
  });

  it('the same place again → duplicate (by place ID), even with a different name', async () => {
    const res = await request(app).post(I).set(bearer(owner.token)).send({ places: [{ placeId: 'ChIJplace000001', name: 'Smile Dental (copy)' }, { placeId: 'ChIJplace000002', name: 'City Dentists' }] });
    assert.equal(res.body.data.imported, 1);
    assert.equal(res.body.data.duplicates, 1);
  });

  it('search marks places that are already leads (a colleague’s lead: existence only)', async () => {
    const s = await request(app).post(S).set(bearer(sales.token)).send({ query: 'Dentist in Islamabad' });
    const [first, second] = s.body.data.results;
    assert.ok(first.existing.leadId, 'their own');
    assert.deepEqual(second.existing, { colleague: true });
  });

  it('another company can import the same place (duplicates are per company) and never sees ours', async () => {
    const res = await request(app).post(I).set(bearer(other.token)).send({ places: [{ placeId: 'ChIJplace000001', name: 'Smile Dental Clinic' }] });
    assert.equal(res.body.data.imported, 1);
  });

  it('Google rejects the key → 400, and the search is given back to your plan', async () => {
    const before = (await sys(() => UsageCounter.findOne({ tenantId: owner.tenant.id, metric: 'discoverySearches' }))).count;
    fake.next = { status: 403, json: () => ({ error: { message: 'API key not valid. secret echo' } }) };
    const res = await request(app).post(S).set(bearer(owner.token)).send({ query: 'Dentist' });
    assert.equal(res.status, 400);
    assert.ok(!JSON.stringify(res.body).includes('secret echo'));
    assert.equal((await sys(() => UsageCounter.findOne({ tenantId: owner.tenant.id, metric: 'discoverySearches' }))).count, before);
  });

  it('validation: bad place IDs, too many places, unknown fields, short query → 400', async () => {
    for (const body of [{ places: [{ placeId: 'x', name: 'A' }] }, { places: Array.from({ length: 51 }, (_, i) => ({ placeId: `ChIJplace${String(i).padStart(6, '0')}`, name: 'A' })) }, { places: [{ placeId: 'ChIJplace000009', name: 'A', phone: '123' }] }]) {
      assert.equal((await request(app).post(I).set(bearer(owner.token)).send(body)).status, 400);
    }
    assert.equal((await request(app).post(S).set(bearer(owner.token)).send({ query: 'a' })).status, 400);
  });
});
