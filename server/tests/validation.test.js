// PHASE 2 — INPUT VALIDATION & SAFE QUERY BUILDER TESTS
import './helpers/setupEnv.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import validate from '../src/middleware/validate.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { z, idParams, pagination, sortBy, httpUrl, safeText } from '../src/validators/common.js';
import { buildFilter, buildSort, escapeRegex, prefixSearch } from '../src/utils/queryBuilder.js';

// A tiny test app with one example endpoint
const app = express();
app.set('query parser', 'simple');
app.use(express.json());
app.post(
  '/items/:id',
  validate({
    params: idParams,
    query: z.object({ ...pagination, sort: sortBy(['name', 'createdAt']) }).strict(),
    body: z.object({ name: safeText(50), website: httpUrl.optional() }).strict(),
  }),
  (req, res) => res.json({ success: true, data: req.validated })
);
app.get('/no-body', validate({}), (_req, res) => res.json({ success: true }));
app.use(errorHandler);

const ID = '64b7f0c2a1b2c3d4e5f60718';

describe('Validation middleware', () => {
  it('accepts valid input and applies defaults', async () => {
    const res = await request(app).post(`/items/${ID}`).send({ name: 'Acme' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.query.page, 1);
    assert.equal(res.body.data.query.limit, 20);
  });

  it('rejects UNKNOWN fields (mass-assignment protection)', async () => {
    const res = await request(app).post(`/items/${ID}`).send({ name: 'Acme', role: 'ADMIN', tenantId: 'x' });
    assert.equal(res.status, 400);
    assert.match(JSON.stringify(res.body.errors), /Unknown field/);
  });

  it('rejects an invalid id', async () => {
    const res = await request(app).post('/items/not-an-id').send({ name: 'Acme' });
    assert.equal(res.status, 400);
  });

  it('caps page size at 100', async () => {
    const res = await request(app).post(`/items/${ID}?limit=5000`).send({ name: 'Acme' });
    assert.equal(res.status, 400);
  });

  it('rejects sort fields that are not allow-listed', async () => {
    const res = await request(app).post(`/items/${ID}?sort=passwordHash`).send({ name: 'Acme' });
    assert.equal(res.status, 400);
  });

  it('rejects javascript: URLs (XSS)', async () => {
    const res = await request(app).post(`/items/${ID}`).send({ name: 'Acme', website: 'javascript:alert(1)' });
    assert.equal(res.status, 400);
  });

  it('rejects too-long text', async () => {
    const res = await request(app).post(`/items/${ID}`).send({ name: 'x'.repeat(51) });
    assert.equal(res.status, 400);
  });

  it('rejects a body on endpoints that accept no body', async () => {
    const res = await request(app).get('/no-body').send({ anything: 1 });
    assert.equal(res.status, 400);
  });
});

describe('Safe query builder', () => {
  it('buildFilter keeps only allow-listed fields with primitive values', () => {
    const filter = buildFilter(
      { status: 'NEW', city: { $ne: null }, passwordHash: 'x' },
      ['status', 'city']
    );
    assert.deepEqual(filter, { status: 'NEW' });
  });

  it('buildSort falls back to default for unknown fields', () => {
    assert.deepEqual(buildSort('-name', ['name']), { name: -1 });
    assert.deepEqual(buildSort('passwordHash', ['name']), { createdAt: -1 });
  });

  it('escapeRegex neutralises regex special characters', () => {
    assert.equal(escapeRegex('a.*(b)'), 'a\\.\\*\\(b\\)');
    assert.ok(prefixSearch('a.*').test('a.*xyz'));
    assert.ok(!prefixSearch('a.*').test('abc'));
  });
});
