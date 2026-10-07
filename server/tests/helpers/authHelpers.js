// Shared helpers for auth tests: register a company, invite users, read cookies.
import request from 'supertest';
import app from '../../src/app.js';

export const ORIGIN = 'http://localhost:5173';
export const GOOD_PASSWORD = 'Str0ngPassw0rd!';

let counter = 0;
export const uniqueEmail = (prefix = 'user') => `${prefix}.${Date.now()}.${++counter}@example.com`;

export const bearer = (token) => ({ Authorization: `Bearer ${token}` });

export function refreshCookieFrom(res) {
  const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('lf_rt=') && !c.startsWith('lf_rt=;'));
  return cookie ? cookie.split(';')[0] : null;
}

export async function registerTenant(overrides = {}) {
  const body = {
    name: 'Owner',
    email: uniqueEmail('owner'),
    password: GOOD_PASSWORD,
    companyName: 'Acme Ltd',
    ...overrides,
  };
  const res = await request(app).post('/api/v1/auth/register').send(body);
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
  return {
    email: body.email,
    password: body.password,
    token: res.body.data.accessToken,
    cookie: refreshCookieFrom(res),
    user: res.body.data.user,
    tenant: res.body.data.tenant,
    res,
  };
}

export async function inviteAndAccept(inviter, role) {
  const email = uniqueEmail(role.toLowerCase());
  const inv = await request(app).post('/api/v1/invitations').set(bearer(inviter.token)).send({ email, role });
  if (inv.status !== 201) throw new Error(`invite failed: ${JSON.stringify(inv.body)}`);
  const token = new URL(inv.body.data.inviteUrl).searchParams.get('token');
  const acc = await request(app)
    .post('/api/v1/invitations/accept')
    .send({ token, name: `${role} user`, password: GOOD_PASSWORD });
  if (acc.status !== 201) throw new Error(`accept failed: ${JSON.stringify(acc.body)}`);
  return {
    email,
    password: GOOD_PASSWORD,
    token: acc.body.data.accessToken,
    cookie: refreshCookieFrom(acc),
    user: acc.body.data.user,
  };
}
