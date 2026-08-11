/**
 * PHASE 4 PUBLIC TOUCHPOINT CHAT SMOKE TESTS
 *
 * Covers: tracking-id resolution to tenant-owned touchpoint + agent, public
 * access without authentication, nonexistent tracking ids, scan recording,
 * conversation/message persistence, resume of existing conversations, agent
 * association, inactive touchpoints, and cross-tenant isolation.
 *
 * The Groq client is swapped for a deterministic fake so chat coverage does
 * not require a live API key.
 *
 * Run with: NODE_ENV=test node --test tests/
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-public-test-'));
process.env.DATA_DIR = DATA_DIR;
process.env.JWT_SECRET = 'test-secret-for-phase4-public-smoke';
process.env.GROQ_API_KEY = 'gsk_test_dummy';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy';
process.env.APP_URL = 'https://app.example.test';
process.env.NODE_ENV = 'test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The /t/:trackingId route renders dist/t.html with an injected payload. If
// the production build has not produced it yet, provide an equivalent fixture
// so the HTML route stays testable on its own.
const serverDistDir = path.join(__dirname, '..', 'dist');
fs.mkdirSync(serverDistDir, { recursive: true });
const tHtmlPath = path.join(serverDistDir, 't.html');
if (!fs.existsSync(tHtmlPath)) {
  fs.writeFileSync(
    tHtmlPath,
    '<!DOCTYPE html><html><head><title>Touchpoint Chat</title></head><body><div id="root"></div><script type="application/json" id="touchpoint-data">__TOUCHPOINT_DATA__</script></body></html>'
  );
}

const { default: app, _setGroqClient } = await import(path.join(__dirname, '..', 'server.js'));

// Deterministic fake Groq: echoes a canned reply derived from the last user
// message so tests can assert the exact assistant text.
_setGroqClient({
  chat: {
    completions: {
      create: async ({ messages }) => {
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        return { choices: [{ message: { content: `Mock reply to: ${lastUser ? lastUser.content : 'nothing'}` } }] };
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

const request = async (url, { method = 'GET', body, token, raw = false } = {}) => {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(base + url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (raw) {
    return { status: res.status, headers: res.headers, text: await res.text() };
  }
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
};

const register = (payload) =>
  request('/v1/auth/register', { method: 'POST', body: payload });

const login = (payload) =>
  request('/v1/auth/login', { method: 'POST', body: payload });

const agentPayload = (overrides = {}) => ({
  name: 'Luxury Concierge',
  industry: 'Real Estate',
  voice: 'professional',
  description: 'High-touch property specialist',
  serviceCatalog: 'Tours, valuations, financing',
  documents: ['pricing.pdf'],
  ...overrides,
});

const touchpointPayload = (overrides = {}) => ({
  name: 'Lobby Sign',
  type: 'Business Card',
  location: 'Lagos HQ',
  ...overrides,
});

// Shared fixtures created by the first test and reused across the suite.
let acme;
let acmeAgentId;
let acmeTrackingId;
let acmeTouchpointId;

const loginAsAcme = async () =>
  (await login({ email: 'acme@public.test', password: 'password123' })).body;

test('valid tracking id resolves to its tenant-owned touchpoint and agent without authentication', async () => {
  const reg = (await register({
    email: 'acme@public.test',
    password: 'password123',
    name: 'Acme Owner',
    businessName: 'Acme Public',
  })).body;
  acme = reg;

  const agent = (await request('/v1/agents', {
    method: 'POST',
    body: agentPayload(),
    token: reg.token,
  })).body.agent;
  acmeAgentId = agent.id;

  const tp = (await request('/v1/touchpoints', {
    method: 'POST',
    body: touchpointPayload({ agentId: agent.id }),
    token: reg.token,
  })).body.touchpoint;
  acmeTrackingId = tp.trackingId;
  acmeTouchpointId = tp.id;

  // Public JSON resolution — no Authorization header at all.
  const resolved = await request(`/v1/t/${acmeTrackingId}`);
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.trackingId, acmeTrackingId);
  assert.equal(resolved.body.status, 'active');
  assert.equal(resolved.body.touchpoint.name, 'Lobby Sign');
  assert.equal(resolved.body.touchpoint.type, 'Business Card');
  assert.equal(resolved.body.agent.name, 'Luxury Concierge');
  assert.equal(resolved.body.agent.industry, 'Real Estate');
  assert.equal(resolved.body.business.name, 'Acme Public');

  // The public surface must not open up the authenticated workspace.
  assert.equal((await request('/v1/agents')).status, 401);
  assert.equal((await request('/v1/touchpoints')).status, 401);
});

test('nonexistent or malformed tracking ids are rejected everywhere', async () => {
  const missing = 'TX-DEADBEEF12345678';

  assert.equal((await request(`/v1/t/${missing}`)).status, 404);
  assert.equal((await request(`/v1/t/not-a-real-id`)).status, 404);
  assert.equal((await request(`/v1/t/${missing}/messages`)).status, 404);
  assert.equal((await request(`/v1/t/${missing}/messages`, { method: 'POST', body: { message: 'Hi' } })).status, 404);
  assert.equal((await request(`/t/${missing}`, { raw: true })).status, 404);
});

test('public HTML page loads without authentication and records exactly one scan per page view', async () => {
  const acmeSession = await loginAsAcme();

  const page = await request(`/t/${acmeTrackingId}`, { raw: true });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') || '', /text\/html/);
  assert.ok(page.text.includes(acmeTrackingId), 'payload embeds the tracking id');
  assert.ok(page.text.includes('Luxury Concierge'), 'payload embeds the agent name');

  const afterFirst = (await request(`/v1/touchpoints/${acmeTouchpointId}`, { token: acmeSession.token })).body.touchpoint;
  assert.equal(afterFirst.scans, 1, 'first page view recorded one scan');

  // The JSON resolution endpoint must not count as a separate scan.
  await request(`/v1/t/${acmeTrackingId}`);
  const afterResolve = (await request(`/v1/touchpoints/${acmeTouchpointId}`, { token: acmeSession.token })).body.touchpoint;
  assert.equal(afterResolve.scans, 1, 'JSON resolution is not a physical scan');

  const page2 = await request(`/t/${acmeTrackingId}`, { raw: true });
  assert.equal(page2.status, 200);
  const afterSecond = (await request(`/v1/touchpoints/${acmeTouchpointId}`, { token: acmeSession.token })).body.touchpoint;
  assert.equal(afterSecond.scans, 2, 'second page view recorded another scan');
});

test('public chat persists the conversation and messages for the resolved agent', async () => {
  const acmeSession = await loginAsAcme();

  const first = await request(`/v1/t/${acmeTrackingId}/messages`, {
    method: 'POST',
    body: { message: 'Hello, what services do you offer?', customerName: 'Ada', targetLanguage: 'en' },
  });
  assert.equal(first.status, 200);
  assert.ok(first.body.conversationId, 'returns a server-assigned conversation id');
  assert.equal(first.body.agent.name, 'Luxury Concierge');
  assert.equal(first.body.customerName, 'Ada');
  assert.equal(first.body.messages.length, 2, 'user + assistant message persisted');
  assert.equal(first.body.messages[0].role, 'user');
  assert.equal(first.body.messages[0].text, 'Hello, what services do you offer?');
  assert.equal(first.body.messages[1].role, 'assistant');
  assert.match(first.body.messages[1].text, /Mock reply/);

  // History is retrievable publicly through the same tracking id.
  const history = await request(`/v1/t/${acmeTrackingId}/messages?conversationId=${first.body.conversationId}`);
  assert.equal(history.status, 200);
  assert.equal(history.body.messages.length, 2);

  // The authenticated dashboard sees the persisted conversation, associated
  // with the touchpoint's agent.
  const list = (await request('/v1/conversations', { token: acmeSession.token })).body;
  assert.equal(list.conversations.length, 1);
  const convo = list.conversations[0];
  assert.equal(convo.agentId, acmeAgentId, 'conversation is linked to the resolved agent');
  assert.equal(convo.agentName, 'Luxury Concierge');
  assert.equal(convo.customerName, 'Ada');
  assert.equal(convo.touchpointId, acmeTouchpointId);
  assert.equal(convo.messageCount, 2);
  assert.equal(convo.lastMessage, first.body.messages[1].text);
});

test('a conversation resumes on later messages and keeps its history', async () => {
  const acmeSession = await loginAsAcme();

  const list = (await request('/v1/conversations', { token: acmeSession.token })).body;
  const existingId = list.conversations[0].id;

  const resumed = await request(`/v1/t/${acmeTrackingId}/messages`, {
    method: 'POST',
    body: { message: 'Tell me more', conversationId: existingId },
  });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.conversationId, existingId, 'conversation id is stable across messages');
  assert.equal(resumed.body.messages.length, 4, 'prior history is carried forward');
  assert.equal(resumed.body.messages[3].role, 'assistant');

  const afterResume = (await request('/v1/conversations', { token: acmeSession.token })).body;
  assert.equal(afterResume.conversations[0].messageCount, 4);
  assert.equal(afterResume.conversations[0].lastMessage, resumed.body.messages[3].text);
});

test('public chat validates its input', async () => {
  assert.equal(
    (await request(`/v1/t/${acmeTrackingId}/messages`, { method: 'POST', body: {} })).status,
    400
  );
  assert.equal(
    (await request(`/v1/t/${acmeTrackingId}/messages`, { method: 'POST', body: { message: '   ' } })).status,
    400
  );
  assert.equal(
    (await request(`/v1/t/${acmeTrackingId}/messages`, { method: 'POST', body: { message: 'x'.repeat(2001) } })).status,
    400
  );
  assert.equal(
    (await request(`/v1/t/${acmeTrackingId}/messages`, { method: 'POST', body: { message: 'Hi', targetLanguage: 'english-english' } })).status,
    400
  );
});

test('a conversation id cannot be addressed through another touchpoint (cross-tenant isolation)', async () => {
  // Second tenant with its own agent + touchpoint.
  const beta = (await register({
    email: 'beta@public.test',
    password: 'password123',
    name: 'Beta Owner',
    businessName: 'Beta Public',
  })).body;

  const betaAgent = (await request('/v1/agents', {
    method: 'POST',
    body: agentPayload({ name: 'Beta Helper' }),
    token: beta.token,
  })).body.agent;

  const betaTp = (await request('/v1/touchpoints', {
    method: 'POST',
    body: touchpointPayload({ name: 'Beta Flyer', agentId: betaAgent.id }),
    token: beta.token,
  })).body.touchpoint;

  // Resolution stays scoped: each tracking id only reveals its own tenant.
  const betaResolved = (await request(`/v1/t/${betaTp.trackingId}`)).body;
  assert.equal(betaResolved.business.name, 'Beta Public');
  assert.equal(betaResolved.agent.name, 'Beta Helper');
  assert.equal(betaResolved.touchpoint.name, 'Beta Flyer');

  const acmeResolved = (await request(`/v1/t/${acmeTrackingId}`)).body;
  assert.equal(acmeResolved.business.name, 'Acme Public');
  assert.notEqual(acmeResolved.agent.name, 'Beta Helper');

  // Acme's conversation must be unreachable through Beta's tracking id.
  const acmeList = (await request('/v1/conversations', { token: (await loginAsAcme()).token })).body;
  const acmeConversationId = acmeList.conversations[0].id;

  const stolen = await request(`/v1/t/${betaTp.trackingId}/messages`, {
    method: 'POST',
    body: { message: 'exfiltrate', conversationId: acmeConversationId },
  });
  assert.equal(stolen.status, 404, 'cross-touchpoint conversation id is rejected');

  const stolenHistory = await request(`/v1/t/${betaTp.trackingId}/messages?conversationId=${acmeConversationId}`);
  assert.equal(stolenHistory.status, 404, 'cross-touchpoint history is rejected');

  // Dashboard lists are business-scoped.
  const betaList = (await request('/v1/conversations', { token: beta.token })).body;
  assert.equal(betaList.conversations.length, 0, 'beta sees no acme conversations');

  const acmeListAfter = (await request('/v1/conversations', { token: (await loginAsAcme()).token })).body;
  assert.equal(acmeListAfter.conversations.length, 1, 'acme still sees only its own conversation');
  assert.equal(acmeListAfter.conversations[0].customerName, 'Ada');
});

test('inactive touchpoints refuse chat and are not counted as scans', async () => {
  const acmeSession = await loginAsAcme();

  const deactivated = await request(`/v1/touchpoints/${acmeTouchpointId}`, {
    method: 'PUT',
    body: { active: false },
    token: acmeSession.token,
  });
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.body.touchpoint.active, false);

  const scansBefore = deactivated.body.touchpoint.scans;

  assert.equal((await request(`/v1/t/${acmeTrackingId}`)).status, 410);
  assert.equal((await request(`/v1/t/${acmeTrackingId}/messages`, { method: 'POST', body: { message: 'Hi' } })).status, 410);
  assert.equal((await request(`/v1/t/${acmeTrackingId}/messages`)).status, 410);

  const page = await request(`/t/${acmeTrackingId}`, { raw: true });
  assert.equal(page.status, 200);
  assert.ok(page.text.includes('inactive'), 'page carries the inactive state for the UI');

  const afterPage = (await request(`/v1/touchpoints/${acmeTouchpointId}`, { token: acmeSession.token })).body.touchpoint;
  assert.equal(afterPage.scans, scansBefore, 'inactive page views do not record scans');
});
