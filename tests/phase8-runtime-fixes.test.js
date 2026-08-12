/**
 * PHASE 8 — PRODUCTION RUNTIME FIX REGRESSION TESTS
 *
 * Covers the three confirmed production runtime fixes:
 *   - every Groq call uses the active `llama-3.3-70b-versatile` model; the
 *     deprecated `llama3-70b-8192` is fully removed from server source.
 *   - TRUST_PROXY resolves to a safe hop count (never permissive `true`) so
 *     Render's X-Forwarded-For header cannot trigger
 *     ERR_ERL_UNEXPECTED_X_FORWARDED_FOR from express-rate-limit.
 *   - the public touchpoint chat and the /v1/ai/chat endpoint degrade
 *     gracefully when Groq fails, returning a safe fallback message instead of
 *     the generic internal "AI logic error", with full detail kept server-side.
 *
 * Run with: NODE_ENV=test node --test tests/phase8-runtime-fixes.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-runtime-test-'));
process.env.DATA_DIR = DATA_DIR;
process.env.JWT_SECRET = 'runtime-fix-test-secret-longer-than-32-chars';
process.env.GROQ_API_KEY = 'gsk_test_dummy';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy';
process.env.APP_URL = 'https://app.example.test';
process.env.CORS_ORIGIN = 'https://app.example.test';
process.env.NODE_ENV = 'test';

const GRACEFUL_FALLBACK =
  "Thanks for reaching out! I'm having a quick connectivity issue — I'll be right with you.";

const { resolveTrustProxy } = await import(path.join(__dirname, '..', 'config', 'env.js'));

test('resolveTrustProxy is safe and never permissive', () => {
  assert.equal(resolveTrustProxy({}), false, 'unset in non-production: do not trust forwarded headers');
  assert.equal(resolveTrustProxy({ NODE_ENV: 'development' }), false);
  assert.equal(resolveTrustProxy({ NODE_ENV: 'test' }), false);
  assert.equal(
    resolveTrustProxy({ NODE_ENV: 'production' }),
    1,
    'production defaults to a single trusted hop (Render)',
  );
  assert.equal(resolveTrustProxy({ NODE_ENV: 'production', TRUST_PROXY: '1' }), 1);
  assert.equal(resolveTrustProxy({ TRUST_PROXY: '1' }), 1, 'explicit hop count is honored');
  assert.equal(resolveTrustProxy({ TRUST_PROXY: '0' }), false, 'explicit opt-out');
  assert.equal(resolveTrustProxy({ TRUST_PROXY: '10.0.0.1' }), '10.0.0.1', 'proxy IP passes through');
  assert.notEqual(
    resolveTrustProxy({ NODE_ENV: 'production', TRUST_PROXY: 'true' }),
    true,
    'never resolves to the permissive boolean true',
  );
});

const { default: app, _setGroqClient } = await import(path.join(__dirname, '..', 'server.js'));

// Groq client that always fails, proving the chat endpoints fall back safely.
_setGroqClient({
  chat: {
    completions: {
      create: async () => {
        const error = new Error('simulated Groq outage: upstream 502');
        error.status = 502;
        throw error;
      },
    },
  },
});

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://localhost:${server.address().port}`;

after(() => {
  server.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
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
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (err) { /* not JSON */ }
  return { status: res.status, body: json, text };
};

let trackingId;

test('public touchpoint chat returns the graceful fallback when Groq fails', async () => {
  const reg = (await request('/v1/auth/register', { method: 'POST', body: {
    email: 'runtime@fix.test', password: 'password123', name: 'Runtime Owner', businessName: 'Runtime Co',
  } })).body;
  assert.ok(reg.token, 'registration returns a session');

  const agent = (await request('/v1/agents', { method: 'POST', body: {
    name: 'Grace Agent', industry: 'Retail', voice: 'professional', serviceCatalog: 'Support',
  }, token: reg.token })).body.agent;
  assert.ok(agent, 'agent created');

  const tp = (await request('/v1/touchpoints', { method: 'POST', body: {
    name: 'Counter Card', type: 'Table Tent', agentId: agent.id,
  }, token: reg.token })).body.touchpoint;
  assert.ok(tp && tp.trackingId, 'touchpoint created');
  trackingId = tp.trackingId;

  const res = await request(`/v1/t/${trackingId}/messages`, {
    method: 'POST',
    body: { message: 'Hello?' },
  });
  assert.equal(res.status, 200, 'AI failure still returns 200 with a graceful fallback');
  assert.ok(res.body.conversationId, 'conversation is created');
  assert.equal(res.body.messages.length, 2, 'fallback assistant message is persisted');
  assert.equal(res.body.messages[0].role, 'user');
  assert.equal(res.body.messages[1].role, 'assistant');
  assert.equal(res.body.messages[1].text, GRACEFUL_FALLBACK);
  assert.ok(!res.text.includes('AI logic error'), 'generic internal error never reaches the customer');
  assert.ok(!res.text.includes('Groq'), 'provider/implementation detail stays server-side');
});

test('/v1/ai/chat returns the safe fallback message instead of internal details when Groq fails', async () => {
  const login = (await request('/v1/auth/login', { method: 'POST', body: {
    email: 'runtime@fix.test', password: 'password123',
  } })).body;
  assert.ok(login.token, 'login returns a session');

  const res = await request('/v1/ai/chat', {
    method: 'POST',
    token: login.token,
    body: {
      agent: { name: 'Grace Agent', industry: 'Retail', voice: 'professional', catalog: 'Support' },
      history: [],
      userInput: 'Hello',
      targetLanguage: 'en',
    },
  });
  assert.equal(res.status, 500);
  assert.equal(res.body.error, GRACEFUL_FALLBACK);
  assert.ok(!res.text.includes('AI logic error'));
  assert.ok(!res.text.includes('Groq'), 'provider/implementation detail stays server-side');
});

test('server source uses the active Groq model and no deprecated reference remains', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(!source.includes('llama3-70b-8192'), 'deprecated model is fully removed from server source');
  assert.ok(source.includes('llama-3.3-70b-versatile'), 'active model is present in server source');
});
