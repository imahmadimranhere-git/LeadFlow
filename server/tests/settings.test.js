// PHASE 7 — ONBOARDING, INDUSTRY PACKS, COMPANY SETTINGS & LOGO UPLOAD
import './helpers/setupEnv.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import IndustryPack from '../src/models/IndustryPack.js';
import TenantAsset from '../src/models/TenantAsset.js';
import { DEFAULT_INDUSTRY_PACKS } from '../src/config/defaultIndustryPacks.js';
import { createPackBody } from '../src/validators/settings.validators.js';
import { contrastRatio, isReadableAccent } from '../src/utils/color.js';
import { runAsSystem } from '../src/utils/tenantContext.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';
import { createAdmin, loginAdmin, adminBearer } from './helpers/adminHelpers.js';
import { bearer, registerTenant, inviteAndAccept } from './helpers/authHelpers.js';

const S = '/api/v1/settings';
// A real 1×1 pixel PNG
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const getSettings = (u) => request(app).get(S).set(bearer(u.token));
const patch = (u, section, body) => request(app).patch(`${S}/${section}`).set(bearer(u.token)).send(body);
const packId = async (code) => String((await IndustryPack.findOne({ code }))._id);
const applyPack = async (u, code, mode) =>
  request(app).post(`${S}/industry-pack`).set(bearer(u.token)).send({ packId: await packId(code), mode });

describe('Company settings & industry packs', () => {
  let owner, sales, otherOwner;
  before(async () => {
    await startTestDb();
    await IndustryPack.insertMany(DEFAULT_INDUSTRY_PACKS);
    owner = await registerTenant({ companyName: 'Alpha Realty' });
    sales = await inviteAndAccept(owner, 'SALES');
    otherOwner = await registerTenant({ companyName: 'Beta Soft' });
  });
  after(stopTestDb);

  it('a new company starts with default settings and onboarding required', async () => {
    const res = await getSettings(owner);
    assert.equal(res.status, 200);
    const s = res.body.data.settings;
    assert.equal(s.onboardingRequired, true);
    assert.equal(s.companyName, 'Alpha Realty');
    assert.ok(s.pipelineStages.includes('Won'));
    assert.equal(s.branding.hasLogo, false);
  });

  it('every team member can READ settings, but SALES cannot change them', async () => {
    assert.equal((await getSettings(sales)).status, 200);
    assert.equal((await patch(sales, 'brand-voice', { tone: 'FRIENDLY' })).status, 403);
    assert.equal((await applyPack(sales, 'real-estate', 'REPLACE')).status, 403);
  });

  it('lists only ACTIVE industry packs', async () => {
    await IndustryPack.updateOne({ code: 'custom' }, { $set: { isActive: false } });
    const res = await request(app).get(`${S}/industry-packs`).set(bearer(owner.token));
    assert.equal(res.body.data.items.length, DEFAULT_INDUSTRY_PACKS.length - 1);
    assert.ok(!res.body.data.items.some((p) => p.code === 'custom'));
  });

  it('an inactive pack cannot be applied', async () => {
    assert.equal((await applyPack(owner, 'custom', 'REPLACE')).status, 400);
    await IndustryPack.updateOne({ code: 'custom' }, { $set: { isActive: true } });
  });

  it('REPLACE copies the Real Estate pack (hashtags, intent phrases, stages, templates)', async () => {
    const res = await applyPack(owner, 'real-estate', 'REPLACE');
    assert.equal(res.status, 200);
    const s = res.body.data.settings;
    assert.ok(s.discovery.hashtags.includes('needaplot'));
    assert.ok(s.discovery.intentPhrases.includes('need a plot'));
    assert.ok(s.discovery.negativeKeywords.includes('agent'));
    assert.ok(s.pipelineStages.includes('Site Visit'));
    assert.ok(s.messageTemplates.length > 0);
    assert.equal(s.industryPack.code, 'real-estate');
  });

  it('MERGE adds a second pack without duplicates and keeps existing items', async () => {
    const res = await applyPack(owner, 'software-web', 'MERGE');
    const tags = res.body.data.settings.discovery.hashtags;
    assert.ok(tags.includes('needaplot') && tags.includes('needwebsite'));
    assert.equal(new Set(tags).size, tags.length);
    assert.ok(res.body.data.settings.pipelineStages.includes('Site Visit'), 'MERGE keeps current stages');
  });

  it('later edits to a pack do NOT change a company that already applied it', async () => {
    await IndustryPack.updateOne({ code: 'real-estate' }, { $set: { hashtags: ['changedbyadmin'] } });
    const s = (await getSettings(owner)).body.data.settings;
    assert.ok(!s.discovery.hashtags.includes('changedbyadmin'));
  });

  it('hashtags are normalised: "#NeedAPlot", "needaplot", " #Flat_For_Rent " → 2 clean tags', async () => {
    const res = await patch(owner, 'discovery', { hashtags: ['#NeedAPlot', 'needaplot', ' #Flat_For_Rent '] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.settings.discovery.hashtags, ['needaplot', 'flat_for_rent']);
  });

  it('hashtags in other languages work; hashtags with spaces or symbols are rejected', async () => {
    assert.equal((await patch(owner, 'discovery', { hashtags: ['#پلاٹ', '#घर'] })).status, 200);
    assert.equal((await patch(owner, 'discovery', { hashtags: ['need a plot'] })).status, 400);
    assert.equal((await patch(owner, 'discovery', { hashtags: ['plot<script>'] })).status, 400);
  });

  it('list sizes are capped (101 keywords rejected)', async () => {
    const keywords = Array.from({ length: 101 }, (_, i) => `keyword ${i}`);
    assert.equal((await patch(owner, 'discovery', { keywords })).status, 400);
  });

  it('unknown sources and unknown fields are rejected', async () => {
    assert.equal((await patch(owner, 'discovery', { preferredSources: ['SCRAPE_ALL'] })).status, 400);
    assert.equal((await patch(owner, 'profile', { tenantId: otherOwner.tenant.id })).status, 400);
  });

  it('profile: javascript: links rejected, empty string clears a field, company name updates the tenant', async () => {
    assert.equal((await patch(owner, 'profile', { website: 'javascript:alert(1)' })).status, 400);
    const ok = await patch(owner, 'profile', { website: 'https://alpha.example', companyName: 'Alpha Realty Islamabad', socialLinks: { instagram: 'https://instagram.com/alpha' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.settings.profile.website, 'https://alpha.example');
    assert.equal(ok.body.data.settings.companyName, 'Alpha Realty Islamabad');
    const cleared = await patch(owner, 'profile', { website: '' });
    assert.equal(cleared.body.data.settings.profile.website, null);
    assert.equal(cleared.body.data.settings.profile.socialLinks.instagram, 'https://instagram.com/alpha', 'other fields untouched');
  });

  it('brand colour must stay readable (too light / too dark rejected; null resets)', async () => {
    assert.equal((await patch(owner, 'branding', { accentColor: '#ffff00' })).status, 400);
    assert.equal((await patch(owner, 'branding', { accentColor: '#000000' })).status, 400);
    assert.equal((await patch(owner, 'branding', { accentColor: 'red' })).status, 400);
    const ok = await patch(owner, 'branding', { accentColor: '#2563EB' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.settings.branding.accentColor, '#2563eb');
    const reset = await patch(owner, 'branding', { accentColor: null });
    assert.equal(reset.body.data.settings.branding.accentColor, null);
  });

  it('pipeline stages must be unique; scoring weights cannot all be zero', async () => {
    assert.equal((await patch(owner, 'pipeline', { pipelineStages: ['New', 'new', 'Won'] })).status, 400);
    const zero = Object.fromEntries(Object.keys((await getSettings(owner)).body.data.settings.scoringWeights).map((k) => [k, 0]));
    assert.equal((await patch(owner, 'scoring', { scoringWeights: zero })).status, 400);
  });

  it('finishing onboarding turns the wizard off', async () => {
    const res = await request(app).post(`${S}/onboarding/complete`).set(bearer(owner.token)).send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.data.settings.onboardingRequired, false);
  });

  it('ISOLATION: another company has its own untouched settings', async () => {
    const s = (await getSettings(otherOwner)).body.data.settings;
    assert.equal(s.companyName, 'Beta Soft');
    assert.equal(s.discovery.hashtags.length, 0);
    assert.equal(s.onboardingRequired, true);
  });
});

describe('Logo upload security', () => {
  let owner, sales, otherOwner;
  before(async () => {
    await startTestDb();
    owner = await registerTenant();
    sales = await inviteAndAccept(owner, 'SALES');
    otherOwner = await registerTenant();
  });
  after(stopTestDb);

  const upload = (u, body, type) => request(app).put(`${S}/branding/logo`).set(bearer(u.token)).set('Content-Type', type).send(body);
  const fetchLogo = (u) => request(app).get(`${S}/branding/logo`).set(bearer(u.token)).buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

  it('a real PNG is stored and served back safely (exact bytes, nosniff, sandbox CSP)', async () => {
    const res = await upload(owner, PNG_1PX, 'image/png');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.hasLogo, true);

    const img = await fetchLogo(owner);
    assert.equal(img.status, 200);
    assert.equal(img.headers['content-type'], 'image/png');
    assert.equal(img.headers['x-content-type-options'], 'nosniff');
    assert.match(img.headers['content-security-policy'], /sandbox/);
    assert.ok(Buffer.compare(img.body, PNG_1PX) === 0);
  });

  it('SVG is rejected (it can contain JavaScript)', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    assert.equal((await upload(owner, svg, 'image/svg+xml')).status, 415);
  });

  it('a non-image renamed to .png is rejected (real type checked from the bytes)', async () => {
    const fake = Buffer.from('<html><script>alert(document.cookie)</script></html>'.padEnd(200, ' '));
    assert.equal((await upload(owner, fake, 'image/png')).status, 415);
  });

  it('declared type must match the real type (PNG bytes sent as JPEG → rejected)', async () => {
    assert.equal((await upload(owner, PNG_1PX, 'image/jpeg')).status, 415);
  });

  it('files over 256 KB are rejected', async () => {
    const big = Buffer.concat([PNG_1PX, Buffer.alloc(300 * 1024)]);
    assert.equal((await upload(owner, big, 'image/png')).status, 413);
  });

  it('SALES can see the logo but cannot change or delete it', async () => {
    assert.equal((await fetchLogo(sales)).status, 200);
    assert.equal((await upload(sales, PNG_1PX, 'image/png')).status, 403);
    assert.equal((await request(app).delete(`${S}/branding/logo`).set(bearer(sales.token))).status, 403);
  });

  it('ISOLATION: another company never receives this logo', async () => {
    assert.equal((await fetchLogo(otherOwner)).status, 404);
  });

  it('replacing the logo deletes the old file; removing it works', async () => {
    await upload(owner, PNG_1PX, 'image/png');
    const count = await runAsSystem('test', () => TenantAsset.countDocuments({ tenantId: owner.tenant.id }));
    assert.equal(count, 1);
    assert.equal((await request(app).delete(`${S}/branding/logo`).set(bearer(owner.token))).status, 200);
    assert.equal((await fetchLogo(owner)).status, 404);
  });
});

describe('Industry packs (super admin)', () => {
  let admin;
  before(async () => {
    await startTestDb();
    admin = await loginAdmin(await createAdmin());
  });
  after(stopTestDb);

  const A = '/api/v1/super-admin/industry-packs';
  const newPack = (code) => ({
    code,
    name: 'Solar Installers',
    hashtags: ['#SolarPanels', 'needsolar'],
    intentPhrases: ['need solar panels'],
    sources: ['GOOGLE_WEB', 'CSV'],
    pipelineStages: ['New', 'Site Survey', 'Won', 'Lost'],
    scoringWeights: { explicitBuyerIntent: 40, websiteCondition: 0, businessRelevance: 10, serviceMatch: 15, industryMatch: 5, locationMatch: 20, contactability: 5, publicActivity: 0, evidenceStrength: 5, profileCompleteness: 0 },
  });

  it('every seed pack passes the same validation rules', () => {
    for (const pack of DEFAULT_INDUSTRY_PACKS) {
      const r = createPackBody.safeParse(pack);
      assert.ok(r.success, `${pack.code}: ${JSON.stringify(r.error?.issues?.[0])}`);
    }
  });

  it('admin creates a new industry (no code change needed — just data)', async () => {
    const res = await request(app).post(A).set(adminBearer(admin)).send(newPack('solar'));
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.data.pack.hashtags, ['solarpanels', 'needsolar']);
  });

  it('duplicate code → 409; code cannot be changed; partial update keeps other fields', async () => {
    assert.equal((await request(app).post(A).set(adminBearer(admin)).send(newPack('solar'))).status, 409);
    const id = (await IndustryPack.findOne({ code: 'solar' }))._id;
    assert.equal((await request(app).patch(`${A}/${id}`).set(adminBearer(admin)).send({ code: 'other' })).status, 400);
    const res = await request(app).patch(`${A}/${id}`).set(adminBearer(admin)).send({ name: 'Solar & Energy' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.pack.name, 'Solar & Energy');
    assert.deepEqual(res.body.data.pack.hashtags, ['solarpanels', 'needsolar']);
  });

  it('a company owner token cannot open the packs admin API', async () => {
    const owner = await registerTenant();
    assert.equal((await request(app).get(A).set(bearer(owner.token))).status, 401);
  });
});

describe('Colour contrast helper', () => {
  it('matches known WCAG values', () => {
    assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21);
    assert.equal(isReadableAccent('#16a34a'), true); // default green
    assert.equal(isReadableAccent('#ffff00'), false);
  });
});
