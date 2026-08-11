/**
 * PHASE 8 — RENDER / PRODUCTION DEPLOYMENT SMOKE TESTS
 *
 * Exercises the exact behaviors a Render deployment depends on, against the
 * real Express app with a fresh temporary DATA_DIR (proving the database
 * initializes on an empty persistent disk):
 *
 *   - health endpoint (200 + live SQLite round-trip)
 *   - SPA serving from dist/ (build-dependent, skipped when not built)
 *   - unknown /v1 API routes return JSON 404, never the SPA shell
 *   - protected API endpoints return 401 without a session
 *   - public /t/:trackingId page + JSON resolution, APP_URL consistency
 *   - Paystack webhook reachable WITHOUT normal auth, HMAC rejected on mismatch
 *   - restricted CORS origin handling
 *   - malformed JSON and oversized payloads fail safely
 *   - fresh-disk database init preserves WAL mode
 *   - the production dist/ contains no secret material
 *
 * Run with: NODE_ENV=test node --test tests/phase8-deploy.test.js
 * (requires a prior `yarn build` for the dist-dependent assertions).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fresh production-style data directory: proves the schema/migrations bootstrap
// on an empty persistent disk (Render /data).
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-deploy-test-'));
process.env.DATA_DIR = DATA_DIR;
process.env.JWT_SECRET = 'deploy-test-secret-longer-than-thirty-two-chars';
process.env.GROQ_API_KEY = 'gsk_test_dummy_deploy';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy_deploy_phase8';
process.env.APP_URL = 'https://touchpoint.example.test';
process.env.CORS_ORIGIN = 'https://touchpoint.example.test';
process.env.NODE_ENV = 'test';

const { default: app } = await import(path.join(__dirname, '..', 'server.js'));

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://localhost:${server.address().port}`;

const distDir = path.join(__dirname, '..', 'dist');
const hasBuild = fs.existsSync(path.join(distDir, 'index.html'));

after(() => {
  server.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const request = async (url, { method = 'GET', body, rawBody, signature, token, origin } = {}) => {
  const headers = {};
  if (body !== undefined || rawBody !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (origin) headers['Origin'] = origin;
  if (signature) headers['x-paystack-signature'] = signature;
  const res = await fetch(base + url, {
    method,
    headers,
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (err) { /* not JSON */ }
  return { status: res.status, body: json, text, headers: res.headers };
};

const register = (payload) => request('/v1/auth/register', { method: 'POST', body: payload });

test('health endpoint returns 200 with a live SQLite round-trip and security headers', async () => {
  const res = await request('/v1/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'healthy');
  assert.equal(res.body.database, 'ok');
  assert.ok(res.body.timestamp, 'health response carries a timestamp');

  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.ok(res.headers.get('strict-transport-security'), 'HSTS header present');
  assert.equal(res.headers.get('x-powered-by'), null, 'X-Powered-By is disabled');
});

test('database initializes from an empty data directory and preserves WAL mode', async () => {
  const dbPath = path.join(DATA_DIR, 'touchpoint.db');
  assert.ok(fs.existsSync(dbPath), 'touchpoint.db was created on the fresh disk');

  const { default: Database } = await import('better-sqlite3');
  const probe = new Database(dbPath, { readonly: true });
  try {
    assert.equal(probe.pragma('journal_mode', { simple: true }), 'wal', 'WAL mode preserved');
    assert.equal(probe.pragma('integrity_check', { simple: true }), 'ok');
    const tables = probe.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    ).all().map((row) => row.name);
    for (const expected of ['businesses', 'users', 'sessions', 'agents', 'touchpoints',
      'touchpoint_scans', 'conversations', 'conversation_messages', 'leads',
      'lead_notifications', 'subscriptions', 'paystack_transactions', 'webhook_events']) {
      assert.ok(tables.includes(expected), `schema contains ${expected}`);
    }
  } finally {
    probe.close();
  }
});

test('unknown /v1 API routes return JSON 404, never the SPA shell', async () => {
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    const res = await request('/v1/no-such-endpoint', { method, body: method === 'POST' ? {} : undefined });
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'Endpoint not found' }, `${method} /v1/unknown returns JSON 404`);
  }
});

test('protected API endpoints return 401 without a session', async () => {
  for (const url of ['/v1/agents', '/v1/touchpoints', '/v1/leads', '/v1/analytics/overview', '/v1/billing/subscription']) {
    const res = await request(url);
    assert.equal(res.status, 401, `${url} requires auth`);
    assert.equal(res.body.error, 'Authentication required');
  }
});

test('public touchpoint resolution and the /t/:trackingId page work end-to-end', async () => {
  const unknown = await request('/v1/t/TX-0000000000000000');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, 'Touchpoint not found');

  const page = await request('/t/TX-0000000000000000');
  assert.equal(page.status, 404);
  assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');

  const registered = (await register({
    email: 'deploy@example.test', password: 'password123', name: 'Deploy Owner', businessName: 'Deploy Co',
  })).body;
  assert.ok(registered.token);

  const agentRes = await request('/v1/agents', {
    method: 'POST', token: registered.token,
    body: { name: 'Deploy Agent', industry: 'Retail', voice: 'professional' },
  });
  assert.equal(agentRes.status, 201);

  const tpRes = await request('/v1/touchpoints', {
    method: 'POST', token: registered.token,
    body: { name: 'Counter Card', type: 'Table Tent', agentId: agentRes.body.agent.id },
  });
  assert.equal(tpRes.status, 201);
  const touchpoint = tpRes.body.touchpoint;
  assert.match(touchpoint.trackingId, /^TX-[0-9a-f]{16}$/i);
  assert.equal(
    touchpoint.url,
    `${process.env.APP_URL}/t/${touchpoint.trackingId}`,
    'generated touchpoint URL is built from APP_URL',
  );

  const json = await request(`/v1/t/${touchpoint.trackingId}`);
  assert.equal(json.status, 200);
  assert.equal(json.body.status, 'active');
  assert.equal(json.body.touchpoint.name, 'Counter Card');

  const html = await request(`/t/${touchpoint.trackingId}`);
  assert.equal(html.status, 200);
  assert.equal(html.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.ok(html.text.includes(touchpoint.trackingId), 'page embeds the resolved payload');
  assert.equal(html.headers.get('cache-control'), 'no-store');
});

test('the raw t.html template is not directly reachable', async () => {
  const res = await request('/t.html');
  assert.equal(res.status, 404);
});

test('Paystack webhook route is reachable without normal auth and HMAC is verified', async () => {
  const event = { event: 'some.unknown.event', id: 'evt_deploy_1', data: { reference: 'TXP-x' } };
  const raw = JSON.stringify(event);

  const noSignature = await request('/v1/billing/webhook', { method: 'POST', rawBody: raw });
  assert.equal(noSignature.status, 401);
  assert.equal(
    noSignature.body.error,
    'Invalid webhook signature',
    'missing signature is rejected by HMAC, not by the auth gate',
  );

  const bad = crypto.createHmac('sha512', 'wrong-secret').update(raw).digest('hex');
  const badSig = await request('/v1/billing/webhook', { method: 'POST', rawBody: raw, signature: bad });
  assert.equal(badSig.status, 401);

  const good = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
  const ok = await request('/v1/billing/webhook', { method: 'POST', rawBody: raw, signature: good });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.received, true);
});

test('CORS rejects disallowed origins and allows the configured production origin', async () => {
  const denied = await request('/v1/health', { origin: 'https://evil.example' });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, 'Not allowed by CORS');

  const allowed = await request('/v1/health', { origin: process.env.CORS_ORIGIN });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), process.env.CORS_ORIGIN);
});

test('malformed JSON and oversized payloads fail safely with JSON errors', async () => {
  const malformed = await request('/v1/auth/login', {
    method: 'POST', rawBody: '{"email": "broken',
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(malformed.body, { error: 'Invalid JSON payload' });

  const huge = '{"payload":"' + 'a'.repeat(200 * 1024) + '"}';
  const oversized = await request('/v1/auth/login', { method: 'POST', rawBody: huge });
  assert.equal(oversized.status, 413);
  assert.deepEqual(oversized.body, { error: 'Payload too large' });
});

test('unknown non-API GET routes serve the SPA', { skip: !hasBuild && 'run `yarn build` first' }, async () => {
  const root = await request('/');
  assert.equal(root.status, 200);
  assert.ok(root.headers.get('content-type').includes('text/html'));
  assert.equal(root.headers.get('cache-control'), 'no-store');
  assert.ok(root.text.includes('<div id="root">'), 'serves the dashboard entry');

  const deep = await request('/some/client/route');
  assert.equal(deep.status, 200);
  assert.ok(deep.text.includes('<div id="root">'), 'unknown GET routes fall back to the SPA');
});

test('the production build contains no secret material', { skip: !hasBuild && 'run `yarn build` first' }, async () => {
  const { findSecretLeaks } = await import(path.join(__dirname, '..', 'scripts', 'verify-dist.js'));
  const leaks = findSecretLeaks(distDir);
  assert.deepEqual(leaks, [], 'no GROQ_API_KEY / PAYSTACK_SECRET_KEY / JWT_SECRET material in dist/');
});
