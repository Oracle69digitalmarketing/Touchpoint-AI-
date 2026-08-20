/**
 * PHASE 5 LEAD CAPTURE & QUALIFICATION SMOKE TESTS
 *
 * Covers: authenticated lead endpoints, unauthenticated rejection, automatic
 * lead extraction from public conversations (via the existing Groq
 * infrastructure), deterministic validation + qualification, one lead per
 * conversation with update-on-recapture, in-app notifications for newly
 * qualified leads, tenant isolation, manual lead creation, and server-side
 * plan-limit enforcement for leads.
 *
 * The Groq client is swapped for a deterministic fake so extraction coverage
 * does not require a live API key.
 *
 * Run with: NODE_ENV=test node --test tests/
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb, cleanupTestDb } from './helpers/test-db.js';

process.env.JWT_SECRET = 'test-secret-for-phase5-leads-smoke';
process.env.GROQ_API_KEY = 'gsk_test_dummy';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy';
process.env.APP_URL = 'https://app.example.test';
process.env.NODE_ENV = 'test';

const testPool = await setupTestDb();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { default: app, _setGroqClient } = await import(path.join(__dirname, '..', 'server.js'));

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

const agentPayload = (overrides = {}) => ({
  name: 'Luxury Concierge',
  industry: 'Real Estate',
  voice: 'professional',
  serviceCatalog: 'Tours, valuations, financing',
  ...overrides,
});

const touchpointPayload = (overrides = {}) => ({
  name: 'Lobby Sign',
  type: 'Business Card',
  location: 'Lagos HQ',
  ...overrides,
});

/**
 * Deterministic fake Groq. Regular chat completions echo a mock reply; when the
 * system prompt identifies the lead extraction call, a canned JSON object is
 * returned instead so tests can assert the exact persisted lead.
 */
const setExtraction = (extract) => {
  _setGroqClient({
    chat: {
      completions: {
        create: async ({ messages }) => {
          const system = (messages.find((m) => m.role === 'system') || {}).content || '';
          if (system.includes('lead qualification engine')) {
            return { choices: [{ message: { content: JSON.stringify(extract) } }] };
          }
          const lastUser = [...messages].reverse().find((m) => m.role === 'user');
          return { choices: [{ message: { content: `Mock reply to: ${lastUser ? lastUser.content : ''}` } }] };
        },
      },
    },
  });
};

const qualifiedExtract = {
  name: 'Ada Obi',
  phone: '+2348012345678',
  email: 'ada@example.com',
  intent: 'Requesting a property tour next week',
  qualificationScore: 85,
};

// Shared fixtures created by the first test and reused across the suite.
let acme;
let acmeAgentId;
let acmeTrackingId;

const loginAsAcme = async () =>
  (await login({ email: 'acme@leads.test', password: 'password123' })).body;

test('leads endpoints reject unauthenticated and invalid-token requests', async () => {
  assert.equal((await request('/v1/leads')).status, 401);
  assert.equal((await request('/v1/leads', { method: 'POST', body: { name: 'X' } })).status, 401);
  assert.equal((await request('/v1/leads/notifications')).status, 401);
  assert.equal((await request('/v1/leads/notifications/read', { method: 'POST' })).status, 401);
  assert.equal((await request('/v1/leads/some-id')).status, 401);

  const bogus = (await request('/v1/leads', { token: 'not-a-real-token' })).status;
  assert.equal(bogus, 401);
});

test('public conversations auto-extract and persist a qualified lead with deterministic qualification', async () => {
  setExtraction(qualifiedExtract);

  const reg = (await register({
    email: 'acme@leads.test',
    password: 'password123',
    name: 'Acme Owner',
    businessName: 'Acme Leads',
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

  const chat = await request(`/v1/t/${acmeTrackingId}/messages`, {
    method: 'POST',
    body: { message: 'Hi, I would love a tour. My name is Ada, reach me on +2348012345678 or ada@example.com.', customerName: 'Ada' },
  });
  assert.equal(chat.status, 200);
  assert.equal(chat.body.messages.length, 2, 'chat still returns the persisted exchange');

  // The authenticated dashboard sees the auto-captured lead.
  const session = await loginAsAcme();
  const list = (await request('/v1/leads', { token: session.token })).body;
  assert.equal(list.leads.length, 1);

  const lead = list.leads[0];
  assert.equal(lead.name, 'Ada Obi');
  assert.equal(lead.phone, '+2348012345678');
  assert.equal(lead.email, 'ada@example.com');
  assert.equal(lead.intent, 'Requesting a property tour next week');
  assert.equal(lead.qualificationScore, 85);
  assert.equal(lead.qualificationStatus, 'qualified', 'score >= 60 derives qualified deterministically');
  assert.equal(lead.source, 'auto');
  assert.equal(lead.notified, true);
  assert.equal(lead.touchpointId, tp.id);
  assert.equal(lead.touchpointName, 'Lobby Sign');
  assert.equal(lead.agentId, acmeAgentId);
  assert.equal(lead.agentName, 'Luxury Concierge');
  assert.equal(lead.conversationId, chat.body.conversationId, 'lead is anchored to its conversation');

  // A one-shot in-app notification is created for the newly qualified lead.
  const notifs = (await request('/v1/leads/notifications', { token: session.token })).body;
  assert.equal(notifs.unread, 1);
  assert.equal(notifs.notifications.length, 1);
  assert.equal(notifs.notifications[0].leadId, lead.id);
  assert.equal(notifs.notifications[0].leadName, 'Ada Obi');
  assert.equal(notifs.notifications[0].readAt, null);
});

test('re-extraction updates the same conversation lead instead of duplicating it', async () => {
  const session = await loginAsAcme();

  // A later message refines the lead: the single conversation keeps one row.
  setExtraction({ ...qualifiedExtract, name: 'Ada Obi Nwosu', qualificationScore: 92 });

  const before = (await request('/v1/leads', { token: session.token })).body.leads;
  const conversationId = before[0].conversationId;

  const resumed = await request(`/v1/t/${acmeTrackingId}/messages`, {
    method: 'POST',
    body: { message: 'Actually can you also email me about financing?', conversationId },
  });
  assert.equal(resumed.status, 200);

  const after = (await request('/v1/leads', { token: session.token })).body.leads;
  assert.equal(after.length, 1, 'still exactly one lead for the conversation');
  assert.equal(after[0].id, before[0].id, 'same lead row, not a duplicate');
  assert.equal(after[0].name, 'Ada Obi Nwosu', 'extracted fields are refreshed');
  assert.equal(after[0].qualificationScore, 92);
  assert.equal(after[0].qualificationStatus, 'qualified');

  // No second notification for the same lead.
  const notifs = (await request('/v1/leads/notifications', { token: session.token })).body;
  assert.equal(notifs.notifications.length, 1, 'one-shot notification is not duplicated');
});

test('mark-read clears unread state but preserves the notification record', async () => {
  const session = await loginAsAcme();

  const unreadBefore = (await request('/v1/leads/notifications', { token: session.token })).body.unread;
  assert.equal(unreadBefore, 1);

  const read = await request('/v1/leads/notifications/read', { method: 'POST', token: session.token });
  assert.equal(read.status, 200);
  assert.equal(read.body.unread, 0);

  const after = (await request('/v1/leads/notifications', { token: session.token })).body;
  assert.equal(after.unread, 0);
  assert.equal(after.notifications.length, 1, 'history is kept after being read');
});

test('extraction with a low score produces an unqualified lead and no notification', async () => {
  setExtraction({ name: 'Bored Browser', phone: null, email: null, intent: 'Just looking around', qualificationScore: 12 });

  const fresh = (await register({
    email: 'gamma@leads.test',
    password: 'password123',
    name: 'Gamma Owner',
    businessName: 'Gamma Leads',
  })).body;

  const agent = (await request('/v1/agents', { method: 'POST', body: agentPayload(), token: fresh.token })).body.agent;
  const tp = (await request('/v1/touchpoints', { method: 'POST', body: touchpointPayload({ name: 'Gamma Card', agentId: agent.id }), token: fresh.token })).body.touchpoint;

  const chat = await request(`/v1/t/${tp.trackingId}/messages`, {
    method: 'POST',
    body: { message: 'Cool poster, just browsing.' },
  });
  assert.equal(chat.status, 200);

  const leads = (await request('/v1/leads', { token: fresh.token })).body.leads;
  assert.equal(leads.length, 1);
  assert.equal(leads[0].qualificationStatus, 'unqualified', 'score < 30 derives unqualified');
  assert.equal(leads[0].notified, false);

  const notifs = (await request('/v1/leads/notifications', { token: fresh.token })).body;
  assert.equal(notifs.unread, 0, 'unqualified leads never notify');
});

test('garbage or non-JSON extraction output never breaks the chat and writes no lead', async () => {
  // The fake returns plain text for BOTH the chat reply and the extraction.
  setExtraction({ name: null, phone: null, email: null, intent: null, qualificationScore: 0 });
  _setGroqClient({
    chat: {
      completions: {
        create: async ({ messages }) => {
          const lastUser = [...messages].reverse().find((m) => m.role === 'user');
          return { choices: [{ message: { content: `Mock reply to: ${lastUser ? lastUser.content : ''}` } }] };
        },
      },
    },
  });

  const fresh = (await register({
    email: 'delta@leads.test',
    password: 'password123',
    name: 'Delta Owner',
    businessName: 'Delta Leads',
  })).body;

  const agent = (await request('/v1/agents', { method: 'POST', body: agentPayload(), token: fresh.token })).body.agent;
  const tp = (await request('/v1/touchpoints', { method: 'POST', body: touchpointPayload({ name: 'Delta Flyer', agentId: agent.id }), token: fresh.token })).body.touchpoint;

  const chat = await request(`/v1/t/${tp.trackingId}/messages`, {
    method: 'POST',
    body: { message: 'Hello there', customerName: 'Dennis' },
  });
  assert.equal(chat.status, 200, 'customer conversation is never degraded');
  assert.equal(chat.body.messages.length, 2);

  const leads = (await request('/v1/leads', { token: fresh.token })).body.leads;
  assert.equal(leads.length, 0, 'unparseable extraction writes nothing');
});

test('lead tenant isolation on read and update', async () => {
  setExtraction(qualifiedExtract);

  const beta = (await register({
    email: 'beta@leads.test',
    password: 'password123',
    name: 'Beta Owner',
    businessName: 'Beta Leads',
  })).body;

  const acmeSession = await loginAsAcme();
  const acmeLeads = (await request('/v1/leads', { token: acmeSession.token })).body.leads;
  const acmeLeadId = acmeLeads[0].id;
  const acmeConvoId = acmeLeads[0].conversationId;

  // Beta cannot read, update, or otherwise reach Acme's lead.
  assert.equal((await request(`/v1/leads/${acmeLeadId}`, { token: beta.token })).status, 404);
  assert.equal((await request(`/v1/leads/${acmeLeadId}`, { method: 'PUT', body: { qualificationStatus: 'unqualified' }, token: beta.token })).status, 404);

  // Beta's manual create cannot reference Acme's conversation.
  const crossTenant = await request('/v1/leads', {
    method: 'POST',
    body: { name: 'Stolen', conversationId: acmeConvoId },
    token: beta.token,
  });
  assert.equal(crossTenant.status, 400, 'cross-tenant conversation reference rejected');

  // Beta sees only its own leads and notifications.
  const betaLeads = (await request('/v1/leads', { token: beta.token })).body.leads;
  assert.equal(betaLeads.length, 0, 'beta sees no acme leads');
  const betaNotifs = (await request('/v1/leads/notifications', { token: beta.token })).body;
  assert.equal(betaNotifs.unread, 0);

  // Beta marking its (empty) notifications read cannot touch Acme's unread.
  await request('/v1/leads/notifications/read', { method: 'POST', token: beta.token });
  const acmeNotifs = (await request('/v1/leads/notifications', { token: acmeSession.token })).body;
  assert.equal(acmeNotifs.notifications.length, 1, 'acme notification history intact');
});

test('manual lead creation validates input and derives status deterministically from score', async () => {
  const session = await loginAsAcme();

  // Validation failures.
  const noContact = await request('/v1/leads', { method: 'POST', body: { intent: 'Nothing here' }, token: session.token });
  assert.equal(noContact.status, 400);
  assert.ok(noContact.body.fields.contact, 'contact field error surfaced');

  assert.equal((await request('/v1/leads', { method: 'POST', body: { name: 'X', email: 'not-an-email' }, token: session.token })).status, 400);
  assert.equal((await request('/v1/leads', { method: 'POST', body: { name: 'X', phone: 'abc' }, token: session.token })).status, 400);
  assert.equal((await request('/v1/leads', { method: 'POST', body: { name: 'X', qualificationScore: 500 }, token: session.token })).status, 400);
  assert.equal((await request('/v1/leads', { method: 'POST', body: { name: 'X', qualificationScore: -1 }, token: session.token })).status, 400);
  assert.equal((await request('/v1/leads', { method: 'POST', body: { name: 'X', qualificationStatus: 'hot' }, token: session.token })).status, 400);

  // A score derives its status on the server.
  const pending = (await request('/v1/leads', { method: 'POST', body: { name: 'Bob', phone: '+234 909 111 2222', qualificationScore: 40 }, token: session.token })).body.lead;
  assert.equal(pending.qualificationStatus, 'pending');
  assert.equal(pending.source, 'manual');
  assert.equal(pending.notified, false);

  // An explicit qualified manual lead raises a notification.
  const qualifiedManual = (await request('/v1/leads', { method: 'POST', body: { name: 'Carol', email: 'carol@example.com', qualificationStatus: 'qualified' }, token: session.token })).body.lead;
  assert.equal(qualifiedManual.qualificationStatus, 'qualified');
  assert.equal(qualifiedManual.qualificationScore, 60, 'qualified default score');

  const notifs = (await request('/v1/leads/notifications', { token: session.token })).body;
  assert.equal(notifs.unread, 1, 'the new manual qualified lead is notified');
  assert.ok(notifs.notifications.some((n) => n.leadId === qualifiedManual.id), 'manual lead notification present');
});

test('lead status updates are validated and a requalified lead notifies once', async () => {
  const session = await loginAsAcme();
  const acmeLeads = (await request('/v1/leads', { token: session.token })).body.leads;
  const manual = acmeLeads.find((l) => l.source === 'manual' && l.name === 'Bob');
  assert.ok(manual, 'manual pending lead exists');

  // Bad status rejected.
  assert.equal((await request(`/v1/leads/${manual.id}`, { method: 'PUT', body: { qualificationStatus: 'super' }, token: session.token })).status, 400);
  assert.equal((await request(`/v1/leads/${manual.id}`, { method: 'PUT', body: { qualificationScore: 250 }, token: session.token })).status, 400);

  // Re-qualifying Bob derives status from score and fires a notification.
  const updated = (await request(`/v1/leads/${manual.id}`, { method: 'PUT', body: { qualificationScore: 78 }, token: session.token })).body.lead;
  assert.equal(updated.qualificationScore, 78);
  assert.equal(updated.qualificationStatus, 'qualified');

  const notifs = (await request('/v1/leads/notifications', { token: session.token })).body;
  const bobNotif = notifs.notifications.find((n) => n.leadId === manual.id);
  assert.ok(bobNotif, 'newly qualified lead produced a notification');
  assert.equal(notifs.notifications.filter((n) => n.leadId === manual.id).length, 1, 'still one notification per lead');

  // Re-updating to the same qualified state does not duplicate.
  await request(`/v1/leads/${manual.id}`, { method: 'PUT', body: { qualificationStatus: 'qualified' }, token: session.token });
  const after = (await request('/v1/leads/notifications', { token: session.token })).body;
  assert.equal(after.notifications.filter((n) => n.leadId === manual.id).length, 1);
});

test('server-side plan-limit enforcement stops lead capture at the Free tier ceiling', async () => {
  setExtraction(qualifiedExtract);

  const fresh = (await register({
    email: 'limited@leads.test',
    password: 'password123',
    name: 'Limited Owner',
    businessName: 'Lead Limited Co',
  })).body;

  const agent = (await request('/v1/agents', { method: 'POST', body: agentPayload(), token: fresh.token })).body.agent;
  const tp = (await request('/v1/touchpoints', { method: 'POST', body: touchpointPayload({ name: 'Limit Node', agentId: agent.id }), token: fresh.token })).body.touchpoint;

  // Free plan allows 15 leads; manual creation fills the ceiling.
  for (let i = 0; i < 15; i++) {
    const ok = await request('/v1/leads', {
      method: 'POST',
      body: { name: `Filler ${i}`, qualificationScore: 70 },
      token: fresh.token,
    });
    assert.equal(ok.status, 201, `manual lead ${i} within limit`);
    assert.equal(ok.body.lead.qualificationStatus, 'qualified');
  }

  const over = await request('/v1/leads', { method: 'POST', body: { name: 'Overflow' }, token: fresh.token });
  assert.equal(over.status, 403);
  assert.equal(over.body.code, 'PLAN_LIMIT_EXCEEDED');

  // Auto-capture respects the same ceiling: the chat still succeeds but no
  // additional lead row is written.
  const chat = await request(`/v1/t/${tp.trackingId}/messages`, {
    method: 'POST',
    body: { message: 'I want to buy, my name is Obi, call +2349000000000', customerName: 'Obi' },
  });
  assert.equal(chat.status, 200, 'chat is never degraded by a full lead quota');

  const count = (await request('/v1/leads', { token: fresh.token })).body.leads.length;
  assert.equal(count, 15, 'no lead persisted past the plan ceiling');
});
