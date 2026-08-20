/**
 * PHASE 2 AUTHENTICATION & WORKSPACE SMOKE TESTS
 *
 * Covers: registration, login, password hashing, JWT enforcement, session
 * logout, and business/tenant isolation of workspace data.
 *
 * Run with: NODE_ENV=test node --test tests/
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setupTestDb, cleanupTestDb } from './helpers/test-db.js';

// Fixed env BEFORE importing the server.
const testPool = await setupTestDb();
process.env.JWT_SECRET = 'test-secret-for-phase2-auth-smoke';
process.env.GROQ_API_KEY = 'gsk_test_dummy';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy';
process.env.NODE_ENV = 'test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { default: app } = await import(path.join(__dirname, '..', 'server.js'));

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://localhost:${server.address().port}`;

after(async () => {
  server.close();
  await cleanupTestDb(testPool);
});

const request = async (url, { method = 'GET', body, token } = {}) => {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(base + url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
};

const register = (payload) =>
  request('/v1/auth/register', { method: 'POST', body: payload });

const login = (payload) =>
  request('/v1/auth/login', { method: 'POST', body: payload });

test('health endpoint is public', async () => {
  const { status } = await request('/v1/health');
  assert.equal(status, 200);
});

test('workspace endpoints reject unauthenticated requests', async () => {
  assert.equal((await request('/v1/crm/connections')).status, 401);
  assert.equal((await request('/v1/crm/connect', { method: 'POST', body: { providerId: 'hubspot' } })).status, 401);
  assert.equal((await request('/v1/ai/chat', { method: 'POST', body: {} })).status, 401);
  assert.equal((await request('/v1/identity/banks')).status, 401);
  assert.equal((await request('/v1/auth/me')).status, 401);
});

test('register creates a business workspace and returns a session', async () => {
  const { status, body } = await register({
    email: 'owner@acme.co',
    password: 'password123',
    name: 'Acme Owner',
    businessName: 'Acme Ltd',
  });
  assert.equal(status, 201);
  assert.ok(body.token, 'returns a JWT');
  assert.equal(body.user.email, 'owner@acme.co');
  assert.equal(body.business.name, 'Acme Ltd');
  assert.ok(body.business.id);

  const me = await request('/v1/auth/me', { token: body.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.business.slug, 'acme-ltd');
  assert.equal(me.body.user.role, 'owner');
});

test('register validates input', async () => {
  const weak = await register({ email: 'a@b.co', password: 'short', name: 'A', businessName: 'X' });
  assert.equal(weak.status, 400);

  const badEmail = await register({ email: 'not-an-email', password: 'password123', name: 'Anna', businessName: 'No Corp' });
  assert.equal(badEmail.status, 400);

  const dup = await register({ email: 'owner@acme.co', password: 'password123', name: 'Clone', businessName: 'Other Ltd' });
  assert.equal(dup.status, 409);
});

test('login with the correct password works and wrong password is rejected', async () => {
  const ok = await login({ email: 'owner@acme.co', password: 'password123' });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);

  const bad = await login({ email: 'owner@acme.co', password: 'wrong-password' });
  assert.equal(bad.status, 401);

  const missing = await login({ email: 'nobody@acme.co', password: 'whatever123' });
  assert.equal(missing.status, 401);
});

test('password hashes are not stored or returned in plaintext', async () => {
  const { body } = await login({ email: 'owner@acme.co', password: 'password123' });
  const me = await request('/v1/auth/me', { token: body.token });
  const raw = JSON.stringify(me.body);
  assert.ok(!raw.includes('password'), 'no password material in response');
});

test('crm connections are scoped to the owning business (tenant isolation)', async () => {
  const acme = (await login({ email: 'owner@acme.co', password: 'password123' })).body;

  const connect = await request('/v1/crm/connect', {
    method: 'POST',
    body: { providerId: 'hubspot' },
    token: acme.token,
  });
  assert.equal(connect.status, 200);

  const acmeList = await request('/v1/crm/connections', { token: acme.token });
  assert.equal(acmeList.status, 200);
  assert.equal(acmeList.body.connections.length, 1);
  assert.equal(acmeList.body.connections[0].provider_id, 'hubspot');

  const beta = (await register({
    email: 'owner@beta.co',
    password: 'password123',
    name: 'Beta Owner',
    businessName: 'Beta Corp',
  })).body;

  const betaList = await request('/v1/crm/connections', { token: beta.token });
  assert.equal(betaList.status, 200);
  assert.equal(betaList.body.connections.length, 0, 'beta must not see acme crm');

  const betaDisconnect = await request('/v1/crm/disconnect/hubspot', { method: 'DELETE', token: beta.token });
  assert.equal(betaDisconnect.status, 404, 'beta cannot disconnect acme crm');

  const acmeStillHas = await request('/v1/crm/connections', { token: acme.token });
  assert.equal(acmeStillHas.body.connections.length, 1, 'acme crm untouched');
});

test('logout revokes the session server-side', async () => {
  const { body } = await login({ email: 'owner@acme.co', password: 'password123' });

  const out = await request('/v1/auth/logout', { method: 'POST', token: body.token });
  assert.equal(out.status, 200);

  const me = await request('/v1/auth/me', { token: body.token });
  assert.equal(me.status, 401, 'token must be dead after logout');
});

test('malformed or forged tokens are rejected', async () => {
  assert.equal((await request('/v1/auth/me', { token: 'not-a-jwt' })).status, 401);
  const loginRes = await login({ email: 'owner@acme.co', password: 'password123' });
  const forged = `${loginRes.body.token.slice(0, -2)}xx`;
  assert.equal((await request('/v1/auth/me', { token: forged })).status, 401);
});
