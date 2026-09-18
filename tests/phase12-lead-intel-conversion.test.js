/**
 * PHASE 12 LEAD INTELLIGENCE + HANDOFF/CONVERSION tests (Batch 3)
 *
 * Batch 3 extends the Batch 2 sales foundation with:
 *
 *   A. incremental, validated lead capture (deterministic values are
 *      authoritative; the LLM may only fill gaps; phone/email captured from the
 *      customer's own words are never overwritten by guesses),
 *   B. an explicit contact-sharing declination that is remembered so the agent
 *      never re-asks (and clears if contact is later shared),
 *   C. qualification status surfaced to the agent (reference only — the numeric
 *      score is never exposed),
 *   D. supported handoff/conversion next-best-actions (offer_handoff,
 *      offer_quote, offer_booking, offer_demo, close) gated on real configured
 *      channels,
 *   E. a public handoff endpoint returning only the tenant's configured
 *      destinations and recording handoff_started,
 *   F. observable funnel events (never fabricated, never "completed"),
 *   G. a tenant-scoped funnel analytics endpoint.
 *
 * The Groq client is swapped for a deterministic fake via the _setGroqClient
 * seam, so no live API key is needed. PostgreSQL-backed.
 *
 * Run with: NODE_ENV=test node --test tests/ (requires a local test database).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb, cleanupTestDb } from './helpers/test-db.js';

process.env.JWT_SECRET = 'test-secret-for-phase12-lead-intel';
process.env.GROQ_API_KEY = 'gsk_test_dummy';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy';
process.env.APP_URL = 'https://app.example.test';
process.env.NODE_ENV = 'test';

const testPool = await setupTestDb();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

const capturedSystemPrompts = [];
let fakeExtraction = { name: null, phone: null, email: null, intent: null, qualificationScore: 0 };
let replyOverride = null;

_setGroqClient({
  chat: {
    completions: {
      create: async ({ messages }) => {
        const system = (messages.find((m) => m.role === 'system') || {}).content || '';
        if (system.includes('lead qualification engine')) {
          return { choices: [{ message: { content: JSON.stringify(fakeExtraction) } }] };
        }
        capturedSystemPrompts.push(system);
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        if (replyOverride) {
          return { choices: [{ message: { content: replyOverride } }] };
        }
        return {
          choices: [{ message: { content: `Mock reply to: ${lastUser ? lastUser.content : ''}` } }],
        };
      },
    },
  },
});

const latestSalesPrompt = () => {
  const prompts = capturedSystemPrompts.filter((p) => p.includes('IDENTITY AND ROLE'));
  return prompts[prompts.length - 1] || '';
};

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://localhost:${server.address().port}`;

after(async () => {
  server.close();
  await cleanupTestDb(testPool);
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
  if (raw) return { status: res.status, text: await res.text() };
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
};

const register = (payload) => request('/v1/auth/register', { method: 'POST', body: payload });

const sendPublic = (trackingId, message, conversationId, customerName = 'Ada') =>
  request(`/v1/t/${trackingId}/messages`, {
    method: 'POST',
    body: { message, customerName, targetLanguage: 'en', conversationId },
  });

const salesStateFor = async (token, conversationId) => {
  const dash = (await request('/v1/conversations', { token })).body.conversations;
  return dash.find((c) => c.id === conversationId) || null;
};

const funnelEventsFor = async (conversationId) => {
  const res = await testPool.query(
    'SELECT event_type, meta FROM funnel_events WHERE conversation_id = $1 ORDER BY created_at',
    [conversationId]
  );
  return res.rows;
};

const funnelTypesFor = async (conversationId) =>
  (await funnelEventsFor(conversationId)).map((r) => r.event_type);

const setExtraction = (value) => { fakeExtraction = value; };
const resetExtraction = () => { fakeExtraction = { name: null, phone: null, email: null, intent: null, qualificationScore: 0 }; };

// Shared fixtures
let gamma;
let gammaAgentId;
let gammaTrackingId;
let gammaTouchpointId;
let delta;
let deltaAgentId;
let deltaTrackingId;
let deltaProductId;

test('setup: register channel-configured and channel-less businesses', async () => {
  gamma = (await register({
    email: 'gamma@phase12.test',
    password: 'password123',
    name: 'Gamma Owner',
    businessName: 'Gamma Fitness',
  })).body;

  gammaAgentId = (await request('/v1/agents', {
    method: 'POST',
    token: gamma.token,
    body: { name: 'Gamma Coach', industry: 'Fitness', voice: 'casual', description: 'Personal training' },
  })).body.agent.id;

  const gammaTp = (await request('/v1/touchpoints', {
    method: 'POST',
    token: gamma.token,
    body: { name: 'Gamma Front Desk', type: 'Business Card', location: 'Abuja', agentId: gammaAgentId },
  })).body.touchpoint;
  gammaTrackingId = gammaTp.trackingId;
  gammaTouchpointId = gammaTp.id;

  await request('/v1/products', {
    method: 'POST',
    token: gamma.token,
    body: { name: '12-Week Transformation', description: 'Coaching program', price: '150000', currency: 'NGN', status: 'active' },
  });

  const put = await request('/v1/business/handoff', {
    method: 'PUT',
    token: gamma.token,
    body: {
      whatsapp: '+2348000000001',
      phone: '+2348000000002',
      email: 'team@gamma.test',
      bookingUrl: 'https://gamma.test/book',
    },
  });
  assert.equal(put.status, 200);

  delta = (await register({
    email: 'delta@phase12.test',
    password: 'password123',
    name: 'Delta Owner',
    businessName: 'Delta Bakery',
  })).body;

  deltaAgentId = (await request('/v1/agents', {
    method: 'POST',
    token: delta.token,
    body: { name: 'Delta Baker', industry: 'Bakery', voice: 'casual', description: 'Fresh bread' },
  })).body.agent.id;

  const deltaTp = (await request('/v1/touchpoints', {
    method: 'POST',
    token: delta.token,
    body: { name: 'Delta Counter', type: 'Business Card', location: 'Enugu', agentId: deltaAgentId },
  })).body.touchpoint;
  deltaTrackingId = deltaTp.trackingId;

  deltaProductId = (await request('/v1/products', {
    method: 'POST',
    token: delta.token,
    body: { name: 'Bread Subscription', price: '20000', currency: 'NGN', status: 'active' },
  })).body.product.id;

  assert.ok(gamma.token && delta.token);
});

// --- A. Deterministic, validated capture ------------------------------------

test('a phone number the customer states is captured deterministically and persisted', async () => {
  const res = await sendPublic(gammaTrackingId, 'my number is 08011122233');
  assert.equal(res.status, 200);
  const state = await salesStateFor(gamma.token, res.body.conversationId);
  assert.equal(state.capturedLeadFields.phone, '08011122233', 'validated phone captured');
  assert.ok((await funnelTypesFor(res.body.conversationId)).includes('lead_field_captured'));
});

test('invalid contact text is never captured', async () => {
  const res = await sendPublic(gammaTrackingId, 'gibberish that is not a phone 000', undefined, 'Anon');
  assert.equal(res.status, 200);
  const state = await salesStateFor(gamma.token, res.body.conversationId);
  assert.equal(state.capturedLeadFields.phone, undefined, 'no bogus phone stored');
});

// --- B. Contact declination latch -------------------------------------------

test('an explicit refusal to share contact is remembered and suppresses request_contact', async () => {
  capturedSystemPrompts.length = 0;
  resetExtraction();

  const decline = await sendPublic(gammaTrackingId, "I'd prefer not to share my number", undefined, 'Nadia');
  assert.equal(decline.status, 200);
  const declinedState = await salesStateFor(gamma.token, decline.body.conversationId);
  assert.equal(declinedState.contactDeclined, true, 'decline latched server-side');

  // A later buying signal would normally ask for contact; with the latch and
  // configured channels the server offers a real handoff instead.
  const later = await sendPublic(gammaTrackingId, "I'm ready to buy", decline.body.conversationId, 'Nadia');
  assert.equal(later.status, 200);
  assert.ok(later.body.handoff, 'customer receives configured destinations');
  assert.ok(latestSalesPrompt().includes('CONTACT SHARING DECLINED'), 'prompt told not to re-ask');
});

test('sharing contact after a decline clears the latch', async () => {
  capturedSystemPrompts.length = 0;
  resetExtraction();
  const first = await sendPublic(gammaTrackingId, "I'd rather not share my details", undefined, 'Omar');
  const second = await sendPublic(gammaTrackingId, 'okay, my number is 08011122233', first.body.conversationId, 'Omar');
  assert.equal(second.status, 200);
  const state = await salesStateFor(gamma.token, second.body.conversationId);
  assert.equal(state.contactDeclined, false, 'sharing contact clears the latch');
  assert.ok(!latestSalesPrompt().includes('CONTACT SHARING DECLINED'));
});

// --- C. Qualification + extraction transitions ------------------------------

test('lead capture merges extracted values without clobbering deterministic ones', async () => {
  const res = await sendPublic(gammaTrackingId, 'my number is 08099988877', undefined, 'Priya');
  setExtraction({ name: 'Priya', phone: '+15550001111', email: null, intent: 'buying', qualificationScore: 80 });
  await sendPublic(gammaTrackingId, 'I am interested in the transformation', res.body.conversationId, 'Priya');
  resetExtraction();

  const row = await testPool.query(
    'SELECT name, phone, qualification_status FROM leads WHERE conversation_id = $1',
    [res.body.conversationId]
  );
  assert.equal(row.rows.length, 1, 'one lead per conversation');
  assert.equal(row.rows[0].phone, '08099988877', 'deterministic phone wins over the extracted guess');
  assert.equal(row.rows[0].qualification_status, 'qualified');
});

test('qualification_updated fires only when the status actually changes', async () => {
  const first = await sendPublic(gammaTrackingId, 'my number is 08077766655', undefined, 'Qual');
  setExtraction({ name: 'Qual', phone: null, email: null, intent: 'buying', qualificationScore: 90 });
  await sendPublic(gammaTrackingId, 'I want to get started', first.body.conversationId, 'Qual');
  resetExtraction();

  const before = await funnelTypesFor(first.body.conversationId);
  assert.ok(!before.includes('qualification_updated'), 'creation is not a qualification change');

  setExtraction({ name: 'Qual', phone: null, email: null, intent: 'browsing', qualificationScore: 10 });
  await sendPublic(gammaTrackingId, 'just looking around for now', first.body.conversationId, 'Qual');
  resetExtraction();
  const after = await funnelTypesFor(first.body.conversationId);
  assert.ok(after.includes('qualification_updated'), 'a real status change is recorded');
});

// --- D. Conversion actions --------------------------------------------------

test('booking is offered only when a booking URL is configured', async () => {
  const res = await sendPublic(gammaTrackingId, "I'd like to book an appointment", undefined, 'Booky');
  assert.equal(res.status, 200);
  assert.equal(res.body.handoff.bookingUrl, 'https://gamma.test/book');
  assert.ok((await funnelTypesFor(res.body.conversationId)).includes('booking_started'));

  const noChannel = await sendPublic(deltaTrackingId, "I'd like to book an appointment", undefined, 'Noa');
  assert.equal(noChannel.status, 200);
  assert.equal(noChannel.body.handoff, undefined, 'no fabricated booking destination');
  assert.ok(!(await funnelTypesFor(noChannel.body.conversationId)).includes('booking_started'));
});

test('quote and demo actions require a contact channel and a captured contact', async () => {
  const first = await sendPublic(gammaTrackingId, 'my number is 08012340000', undefined, 'Quote');
  const quote = await sendPublic(gammaTrackingId, 'please send me a quotation', first.body.conversationId, 'Quote');
  assert.equal(quote.status, 200);
  assert.ok(quote.body.handoff, 'handoff destinations returned');
  assert.ok((await funnelTypesFor(first.body.conversationId)).includes('quote_requested'));

  const firstDemo = await sendPublic(gammaTrackingId, 'my email is demo@gamma.test', undefined, 'Demo');
  const demo = await sendPublic(gammaTrackingId, 'can I get a demo first?', firstDemo.body.conversationId, 'Demo');
  assert.equal(demo.status, 200);
  assert.ok((await funnelTypesFor(firstDemo.body.conversationId)).includes('demo_requested'));
});

test('a purchase intent with captured contact becomes close and records purchase_started', async () => {
  const first = await sendPublic(gammaTrackingId, 'my number is 08055544433', undefined, 'Buyer');
  const buy = await sendPublic(gammaTrackingId, 'I want to complete the purchase now', first.body.conversationId, 'Buyer');
  assert.equal(buy.status, 200);
  const state = await salesStateFor(gamma.token, first.body.conversationId);
  assert.equal(state.nextBestAction, 'close');
  assert.ok((await funnelTypesFor(first.body.conversationId)).includes('purchase_started'));
});

// --- E. Public handoff endpoint ---------------------------------------------

test('the public handoff endpoint returns only configured destinations and records handoff_started', async () => {
  const res = await request(`/v1/t/${gammaTrackingId}/handoff`);
  assert.equal(res.status, 200);
  assert.equal(res.body.channels.whatsapp, '+2348000000001');
  assert.equal(res.body.channels.phone, '+2348000000002');
  assert.equal(res.body.channels.email, 'team@gamma.test');
  assert.equal(res.body.channels.bookingUrl, 'https://gamma.test/book');

  const started = await testPool.query(
    "SELECT COUNT(*) AS n FROM funnel_events WHERE business_id = (SELECT business_id FROM touchpoints WHERE tracking_id = $1) AND event_type = 'handoff_started'",
    [gammaTrackingId]
  );
  assert.ok(parseInt(started.rows[0].n, 10) >= 1, 'handoff_started observed');

  const none = await request(`/v1/t/${deltaTrackingId}/handoff`);
  assert.equal(none.status, 200);
  assert.deepEqual(none.body.channels, {}, 'unconfigured tenant exposes nothing');
});

test('the public handoff endpoint 404s for unknown tracking ids', async () => {
  const res = await request('/v1/t/does-not-exist/handoff');
  assert.equal(res.status, 404);
});

// --- F. No fabricated state or completion -----------------------------------

test('public chat never leaks internal state and never claims completion', async () => {
  const res = await sendPublic(gammaTrackingId, 'Hello, what do you offer?', undefined, 'Leak');
  assert.equal(res.status, 200);
  const raw = JSON.stringify(res.body);
  for (const forbidden of ['qualificationScore', 'capturedLeadFields', 'questionsAsked', 'nextBestAction', 'handoff_completed', 'conversion_completed']) {
    assert.ok(!raw.includes(forbidden), `${forbidden} not exposed`);
  }

  const completed = await testPool.query(
    "SELECT COUNT(*) AS n FROM funnel_events WHERE event_type IN ('handoff_completed', 'conversion_completed')"
  );
  assert.equal(parseInt(completed.rows[0].n, 10), 0, 'completion is never recorded');
});

// --- G. Funnel analytics ----------------------------------------------------

test('the funnel analytics endpoint is tenant-scoped and validates its range', async () => {
  const g = await request('/v1/analytics/funnel', { token: gamma.token });
  assert.equal(g.status, 200);
  assert.ok(g.body.events.booking_started >= 1, 'gamma sees its own observed activity');
  assert.equal(typeof g.body.events.handoff_completed, 'undefined', 'completion never reported');

  const d = await request('/v1/analytics/funnel', { token: delta.token });
  assert.equal(d.status, 200);
  assert.equal(d.body.events.booking_started || 0, 0, 'delta does not see gamma activity');

  const bad = await request('/v1/analytics/funnel?range=nonsense', { token: gamma.token });
  assert.equal(bad.status, 400);

  const unauth = await request('/v1/analytics/funnel');
  assert.equal(unauth.status, 401);
});

test('the dashboard conversation view exposes contactDeclined but never the raw score', async () => {
  const res = await sendPublic(gammaTrackingId, "please don't share my contact", undefined, 'DashTest');
  const state = await salesStateFor(gamma.token, res.body.conversationId);
  assert.equal(state.contactDeclined, true);
  assert.equal(state.qualificationScore, undefined, 'numeric score never leaves the server');
});
