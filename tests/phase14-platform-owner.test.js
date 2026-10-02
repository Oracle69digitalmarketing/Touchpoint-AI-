/**
 * PHASE 14 PLATFORM-OWNER AUTHORIZATION TESTS (Phases 1-3)
 *
 * Covers: requirePlatformOwner 401/403/200 semantics, admin business list +
 * detail at platform scope, no self-escalation via client fields, no
 * business_id override of authorization, response redaction, and continued
 * tenant scoping of normal workspace endpoints.
 *
 * Requires DATABASE_URL (same convention as all suites in tests/helpers).
 * Run with: NODE_ENV=test node --test tests/phase14-platform-owner.test.js
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setupTestDb, cleanupTestDb } from './helpers/test-db.js';

const testPool = await setupTestDb();
process.env.JWT_SECRET = 'test-secret-for-phase14-platform-owner';
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

let ownerToken;
let ownerBusinessId;
let platformToken;
let platformBusinessId;

before(async () => {
  const owner = await request('/v1/auth/register', {
    method: 'POST',
    body: {
      email: 'owner14@acme.co',
      password: 'password123',
      name: 'Ordinary Owner',
      businessName: 'Ordinary Ltd',
    },
  });
  assert.equal(owner.status, 201);
  ownerToken = owner.body.token;
  ownerBusinessId = owner.body.business.id;

  const platform = await request('/v1/auth/register', {
    method: 'POST',
    body: {
      email: 'operator14@touchpoint.ai',
      password: 'password123',
      name: 'Platform Operator',
      businessName: 'Operator Workspace',
    },
  });
  assert.equal(platform.status, 201);
  platformToken = platform.body.token;
  platformBusinessId = platform.body.business.id;

  // Bootstrap the flag the only supported way: direct administrative SQL.
  // There is intentionally no API that writes this column.
  await testPool.query('UPDATE users SET is_platform_owner = TRUE WHERE email = $1', [
    'operator14@touchpoint.ai',
  ]);

  // Re-login so the platform session reflects the current database row.
  const relogin = await request('/v1/auth/login', {
    method: 'POST',
    body: { email: 'operator14@touchpoint.ai', password: 'password123' },
  });
  assert.equal(relogin.status, 200);
  platformToken = relogin.body.token;
});

test('unauthenticated admin access is 401', async () => {
  assert.equal((await request('/v1/admin/businesses')).status, 401);
  assert.equal((await request('/v1/admin/businesses/some-id')).status, 401);
});

test('ordinary business owner gets 403 on admin list and detail', async () => {
  assert.equal((await request('/v1/admin/businesses', { token: ownerToken })).status, 403);
  assert.equal(
    (await request(`/v1/admin/businesses/${platformBusinessId}`, { token: ownerToken })).status,
    403
  );
});

test('platform owner lists businesses with pagination and allowlisted fields', async () => {
  const { status, body } = await request('/v1/admin/businesses?limit=25&offset=0', {
    token: platformToken,
  });
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.businesses));
  assert.ok(body.businesses.length >= 2);
  assert.equal(typeof body.total, 'number');
  assert.equal(body.limit, 25);
  assert.equal(body.offset, 0);
  const raw = JSON.stringify(body);
  for (const secret of [
    'password_hash',
    'verification_token',
    'token_hash',
    'session',
    'sid',
    'authorization',
    'paystack_customer_code',
    'paystack_subscription_code',
    'paystack_email_token',
  ]) {
    assert.ok(!raw.includes(secret), `admin list must not contain ${secret}`);
  }
  const first = body.businesses[0];
  for (const field of [
    'businessId',
    'businessName',
    'slug',
    'plan',
    'subscriptionStatus',
    'registrationDate',
    'userCount',
    'agentCount',
    'touchpointCount',
    'productCount',
    'leadCount',
  ]) {
    assert.ok(first[field] !== undefined, `admin list row includes ${field}`);
  }
});

test('platform owner retrieves a registered business by id with allowlisted users', async () => {
  const { status, body } = await request(`/v1/admin/businesses/${ownerBusinessId}`, {
    token: platformToken,
  });
  assert.equal(status, 200);
  assert.equal(body.business.businessId, ownerBusinessId);
  assert.ok(Array.isArray(body.users));
  const raw = JSON.stringify(body);
  assert.ok(!raw.includes('password_hash'));
  assert.ok(!raw.includes('conversation_messages'));
  for (const u of body.users) {
    assert.deepEqual(Object.keys(u).sort(), ['createdAt', 'email', 'id', 'name', 'role']);
  }
});

test('client-supplied is_platform_owner never elevates privileges', async () => {
  assert.equal(
    (await request('/v1/admin/businesses', { token: ownerToken })).status,
    403
  );
  // Body/query smuggling attempts hit unknown-route or authz handling, never 200.
  const smuggled = await request('/v1/admin/businesses?is_platform_owner=true', {
    token: ownerToken,
  });
  assert.equal(smuggled.status, 403);
  const me = await request('/v1/auth/me', { token: ownerToken });
  assert.equal(me.status, 200);
  assert.ok(!('is_platform_owner' in me.body.user));
  assert.ok(!('isPlatformOwner' in me.body.user));
});

test('client-supplied business_id never alters admin authorization', async () => {
  const { status } = await request(
    `/v1/admin/businesses/${ownerBusinessId}?business_id=${platformBusinessId}`,
    { token: ownerToken }
  );
  assert.equal(status, 403);
});

test('admin responses contain no secrets or message bodies', async () => {
  const list = await request('/v1/admin/businesses', { token: platformToken });
  const detail = await request(`/v1/admin/businesses/${ownerBusinessId}`, {
    token: platformToken,
  });
  const raw = JSON.stringify({ list: list.body, detail: detail.body }).toLowerCase();
  for (const banned of [
    'password_hash',
    'jwt',
    'bearer',
    'reset',
    'secret',
    'api_key',
    'apikey',
    'wa_message_id',
    'message bodies',
  ]) {
    assert.ok(!raw.includes(banned), `admin payload must not contain ${banned}`);
  }
});

test('existing tenant endpoints remain scoped to req.business.id', async () => {
  const mine = await request('/v1/agents', { token: ownerToken });
  assert.equal(mine.status, 200);
  // Ordinary owner cannot see the operator workspace via tenant routes.
  const other = await request(`/v1/leads/${platformBusinessId}`, { token: ownerToken });
  assert.ok([400, 404].includes(other.status));
});
