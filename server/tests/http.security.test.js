// PHASE 1 SECURITY BASELINE TESTS (HTTP level)
import './helpers/setupEnv.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';

describe('HTTP security baseline', () => {
  before(startTestDb);
  after(stopTestDb);

  it('health check returns the standard success format and DB status', async () => {
    const res = await request(app).get('/api/v1/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.db, 'connected');
  });

  it('sends security headers and hides X-Powered-By', async () => {
    const res = await request(app).get('/api/v1/health');
    assert.ok(res.headers['content-security-policy'], 'CSP missing');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.ok(res.headers['x-frame-options'], 'X-Frame-Options missing');
    assert.ok(res.headers['permissions-policy'], 'Permissions-Policy missing');
    assert.ok(res.headers['x-request-id'], 'X-Request-Id missing');
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  it('unknown route returns a safe 404 (no internals)', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { success: false, message: 'Route not found', errors: [] });
  });

  it('CORS: blocks unknown website origins', async () => {
    const res = await request(app).get('/api/v1/health').set('Origin', 'https://evil.com');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  it('CORS: allows our own frontend origin', async () => {
    const res = await request(app).get('/api/v1/health').set('Origin', 'http://localhost:5173');
    assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173');
  });

  it('rejects request bodies larger than 100kb (413)', async () => {
    const big = JSON.stringify({ a: 'x'.repeat(200_000) });
    const res = await request(app).post('/api/v1/health').set('Content-Type', 'application/json').send(big);
    assert.equal(res.status, 413);
    assert.equal(res.body.success, false);
  });

  it('broken JSON gives a safe 400 without stack trace', async () => {
    const res = await request(app).post('/api/v1/health').set('Content-Type', 'application/json').send('{bad');
    assert.equal(res.status, 400);
    assert.equal(res.body.message, 'Invalid JSON body');
    assert.equal(res.body.stack, undefined);
    assert.equal(res.body.debug, undefined);
  });

  it('NoSQL injection: rejects $operators in JSON body', async () => {
    const res = await request(app).post('/api/v1/health').send({ email: { $ne: null } });
    assert.equal(res.status, 400);
  });

  it('NoSQL injection: rejects $operators in query string', async () => {
    const res = await request(app).get('/api/v1/health?email[$ne]=x');
    assert.equal(res.status, 400);
  });

  it('prototype pollution: rejects __proto__ keys', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"__proto__":{"isAdmin":true}}');
    assert.equal(res.status, 400);
    assert.equal({}.isAdmin, undefined);
  });
});
