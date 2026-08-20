/**
 * PHASE 6 ANALYTICS SMOKE TESTS
 *
 * Covers: authenticated analytics endpoints, unauthenticated rejection, range
 * validation, metric accuracy against real persisted scans / conversations /
 * leads, qualification-rate derivation, per-touchpoint and per-agent
 * performance, 7 vs 30-day windowing (including backdated rows), empty-state
 * zeroing, and strict business-tenant isolation.
 *
 * The Groq client is swapped for a deterministic fake so chat-driven lead
 * capture does not require a live API key.
 *
 * Run with: NODE_ENV=test node --test tests/
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.JWT_SECRET = 'test-secret-for-phase6-analytics-smoke';
process.env.GROQ_API_KEY = 'gsk_test_dummy';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy';
process.env.APP_URL = 'https://app.example.test';
process.env.NODE_ENV = 'test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The /t/:trackingId route renders dist/t.html with an injected payload. If
// the production build has not produced it yet, provide an equivalent fixture
// so scan recording stays testable on its own.
import fs from 'node:fs';
const serverDistDir = path.join(__dirname, '..', 'dist');
fs.mkdirSync(serverDistDir, { recursive: true });
const tHtmlPath = path.join(serverDistDir, 't.html');
if (!fs.existsSync(tHtmlPath)) {
  fs.writeFileSync(
    tHtmlPath,
    '<!DOCTYPE html><html><head><title>Touchpoint Chat</title></head><body><div id="root"></div><script type="application/json" id="touchpoint-data">__TOUCHPOINT_DATA__</script></body></html>'
  );
}

import { setupTestDb, cleanupTestDb } from './helpers/test-db.js';

const testPool = await setupTestDb();

const { default: app, _setGroqClient } = await import(path.join(__dirname, '..', 'server.js'));

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

const register = (payload) =>
  request('/v1/auth/register', { method: 'POST', body: payload });

const login = (payload) =>
  request('/v1/auth/login', { method: 'POST', body: payload });

const agentPayload = (overrides = {}) => ({
  name: 'Analytics Concierge',
  industry: 'Real Estate',
  voice: 'professional',
  serviceCatalog: 'Tours, valuations, financing',
  ...overrides,
});

const touchpointPayload = (overrides = {}) => ({
  name: 'HQ Node',
  type: 'Business Card',
  location: 'Lagos HQ',
  ...overrides,
});

const qualifiedExtract = {
  name: 'Ada Obi',
  phone: '+2348012345678',
  email: 'ada@example.com',
  intent: 'Requesting a property tour next week',
  qualificationScore: 85,
};

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

/**
 * Seeds backdated rows directly into PostgreSQL using the shared pool.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const pgTimestamp = (ms) => new Date(ms).toISOString();

const seedBackdated = async ({ businessId, touchpointId, agentId, daysAgo }) => {
  const when = pgTimestamp(Date.now() - daysAgo * DAY_MS);

  await testPool.query(
    'INSERT INTO touchpoint_scans (id, touchpoint_id, business_id, user_agent, created_at) VALUES ($1, $2, $3, $4, $5)',
    [crypto.randomUUID(), touchpointId, businessId, 'backdated-seed', when]
  );
  await testPool.query(
    'INSERT INTO touchpoint_scans (id, touchpoint_id, business_id, user_agent, created_at) VALUES ($1, $2, $3, $4, $5)',
    [crypto.randomUUID(), touchpointId, businessId, 'backdated-seed', when]
  );

  for (const lead of [
    { name: 'Old Qualified', score: 80, status: 'qualified', notified: true },
    { name: 'Old Pending', score: 40, status: 'pending', notified: false },
  ]) {
    const conversationId = crypto.randomUUID();
    await testPool.query(
      'INSERT INTO conversations (id, business_id, touchpoint_id, agent_id, customer_name, target_language, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [conversationId, businessId, touchpointId, agentId, lead.name, 'en', when, when]
    );
    await testPool.query(
      `INSERT INTO leads (id, business_id, touchpoint_id, conversation_id, agent_id, name, phone, email, intent,
         qualification_score, qualification_status, source, notified, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [crypto.randomUUID(), businessId, touchpointId, conversationId, agentId, lead.name, null, null, 'History', lead.score, lead.status, 'auto', lead.notified, when, when]
    );
  }
};

// Registrations / fixture handles shared across the suite.
let metrics;     // Business A: exact in-window activity for metric assertions.
let ranges;      // Business C: current + backdated activity for windowing.
let empty;       // Business D: an agent and touchpoint with zero activity.

const bootBusiness = async (prefix) => {
  const reg = (await register({
    email: `${prefix}@analytics.test`,
    password: 'password123',
    name: `${prefix} Owner`,
    businessName: `${prefix} Analytics Co`,
  })).body;
  const agent = (await request('/v1/agents', {
    method: 'POST', body: agentPayload({ name: `${prefix} Agent` }), token: reg.token,
  })).body.agent;
  const tp = (await request('/v1/touchpoints', {
    method: 'POST', body: touchpointPayload({ name: `${prefix} Node`, agentId: agent.id }), token: reg.token,
  })).body.touchpoint;
  return { ...reg, agent, tp };
};

test('analytics endpoints reject unauthenticated and invalid-token requests', async () => {
  for (const url of [
    '/v1/analytics/overview',
    '/v1/analytics/overview?range=30d',
    '/v1/analytics/touchpoints',
    '/v1/analytics/touchpoints?range=7d',
    '/v1/analytics/agents',
    '/v1/analytics/agents?range=all',
  ]) {
    assert.equal((await request(url)).status, 401, `${url} requires a token`);
  }
  assert.equal(
    (await request('/v1/analytics/overview', { token: 'not-a-real-token' })).status,
    401,
  );
});

test('analytics endpoints reject unknown ranges with 400', async () => {
  const reg = (await register({
    email: 'validation@analytics.test',
    password: 'password123',
    name: 'Validation Owner',
    businessName: 'Validation Co',
  })).body;

  for (const url of [
    '/v1/analytics/overview?range=6d',
    '/v1/analytics/overview?range=year',
    '/v1/analytics/touchpoints?range=forever',
    '/v1/analytics/agents?range=42d',
  ]) {
    const res = await request(url, { token: reg.token });
    assert.equal(res.status, 400, `${url} must be rejected`);
    assert.ok(/range must be one of/.test(res.body.error), 'error names the valid ranges');
  }

  // Missing range defaults to 7d instead of erroring.
  assert.equal((await request('/v1/analytics/overview', { token: reg.token })).status, 200);
});

test('a fresh workspace returns zeroed metrics and empty trend buckets', async () => {
  empty = await bootBusiness('empty');

  const overview = (await request('/v1/analytics/overview?range=7d', { token: empty.token })).body;
  assert.deepEqual(overview.totals, { scans: 0, conversations: 0, leads: 0, qualifiedLeads: 0 });
  assert.deepEqual(overview.deltas, { scans: null, conversations: null, leads: null, qualifiedLeads: null });
  assert.equal(overview.qualificationRate, 0);
  assert.equal(overview.trends.unit, 'day');
  assert.equal(overview.trends.points.length, 7, '7d returns 7 daily buckets');
  assert.ok(overview.trends.points.every((p) => p.scans === 0 && p.conversations === 0 && p.leads === 0 && p.qualifiedLeads === 0));

  // All-time totals are also zero.
  const all = (await request('/v1/analytics/overview?range=all', { token: empty.token })).body;
  assert.equal(all.totals.scans, 0);
  assert.equal(all.totals.leads, 0);

  // The provisioned node and agent exist but report honest zeros.
  const tps = (await request('/v1/analytics/touchpoints?range=30d', { token: empty.token })).body;
  assert.equal(tps.touchpoints.length, 1);
  assert.equal(tps.touchpoints[0].name, 'empty Node');
  assert.equal(tps.touchpoints[0].scans, 0);
  assert.equal(tps.touchpoints[0].leads, 0);
  assert.equal(tps.touchpoints[0].qualificationRate, 0);

  const agents = (await request('/v1/analytics/agents?range=30d', { token: empty.token })).body;
  assert.equal(agents.agents.length, 1);
  assert.equal(agents.agents[0].name, 'empty Agent');
  assert.equal(agents.agents[0].conversations, 0);
  assert.equal(agents.agents[0].qualifiedLeads, 0);
  assert.equal(agents.agents[0].qualificationRate, 0);
});

test('overview metrics match real persisted scans, conversations and leads exactly', async () => {
  setExtraction(qualifiedExtract);
  metrics = await bootBusiness('metrics');

  // One physical scan.
  const page = await request(`/t/${metrics.tp.trackingId}`, { raw: true });
  assert.equal(page.status, 200);

  // One conversation that auto-extracts a qualified lead.
  const chat = await request(`/v1/t/${metrics.tp.trackingId}/messages`, {
    method: 'POST',
    body: { message: 'Hi, I want a tour. Ada, +2348012345678, ada@example.com.', customerName: 'Ada' },
  });
  assert.equal(chat.status, 200);
  assert.equal(chat.body.messages.length, 2);

  // Two manual leads anchored to the node (qualified + pending).
  const manualQ = await request('/v1/leads', {
    method: 'POST',
    body: { name: 'Manual Q', qualificationScore: 70, touchpointId: metrics.tp.id },
    token: metrics.token,
  });
  assert.equal(manualQ.status, 201);
  assert.equal(manualQ.body.lead.qualificationStatus, 'qualified');

  const manualP = await request('/v1/leads', {
    method: 'POST',
    body: { name: 'Manual P', qualificationScore: 40, touchpointId: metrics.tp.id },
    token: metrics.token,
  });
  assert.equal(manualP.status, 201);
  assert.equal(manualP.body.lead.qualificationStatus, 'pending');

  const overview = (await request('/v1/analytics/overview?range=7d', { token: metrics.token })).body;
  assert.deepEqual(overview.totals, { scans: 1, conversations: 1, leads: 3, qualifiedLeads: 2 });
  assert.equal(overview.qualificationRate, 66.7, 'qualified / leads * 100 rounded to one decimal');

  // Previous 7-day window is empty, so deltas are null rather than fabricated.
  assert.deepEqual(overview.deltas, { scans: null, conversations: null, leads: null, qualifiedLeads: null });

  // Trend buckets: only today carries the activity.
  assert.equal(overview.trends.points.length, 7);
  const today = overview.trends.points[overview.trends.points.length - 1];
  assert.deepEqual(
    { scans: today.scans, conversations: today.conversations, leads: today.leads, qualifiedLeads: today.qualifiedLeads },
    { scans: 1, conversations: 1, leads: 3, qualifiedLeads: 2 },
  );
  for (const point of overview.trends.points.slice(0, -1)) {
    assert.equal(point.scans + point.leads, 0, 'earlier buckets are empty');
  }
});

test('per-touchpoint performance attributes activity to the owning node', async () => {
  const res = (await request('/v1/analytics/touchpoints?range=7d', { token: metrics.token })).body;
  assert.equal(res.touchpoints.length, 1);
  const tp = res.touchpoints[0];
  assert.equal(tp.name, 'metrics Node');
  assert.equal(tp.scans, 1);
  assert.equal(tp.conversations, 1);
  assert.equal(tp.leads, 3);
  assert.equal(tp.qualifiedLeads, 2);
  assert.equal(tp.qualificationRate, 66.7);
});

test('per-agent performance only counts leads attributed to the agent', async () => {
  const res = (await request('/v1/analytics/agents?range=7d', { token: metrics.token })).body;
  assert.equal(res.agents.length, 1);
  const agent = res.agents[0];
  assert.equal(agent.name, 'metrics Agent');
  assert.equal(agent.conversations, 1);
  // The two manual leads carry no conversation, so they are never misattributed.
  assert.equal(agent.leads, 1);
  assert.equal(agent.qualifiedLeads, 1);
  assert.equal(agent.qualificationRate, 100);
});

test('7d and 30d windows are scoped correctly against backdated rows', async () => {
  ranges = await bootBusiness('range');

  // Backdated (10 days ago) scans, conversations, and leads belong to the
  // tenant but fall outside the 7-day window.
  await seedBackdated({
    businessId: ranges.business.id,
    touchpointId: ranges.tp.id,
    agentId: ranges.agent.id,
    daysAgo: 10,
  });

  // One real scan today.
  await request(`/t/${ranges.tp.trackingId}`, { raw: true });

  const short = (await request('/v1/analytics/overview?range=7d', { token: ranges.token })).body;
  assert.deepEqual(short.totals, { scans: 1, conversations: 0, leads: 0, qualifiedLeads: 0 });
  assert.equal(short.qualificationRate, 0);

  const long = (await request('/v1/analytics/overview?range=30d', { token: ranges.token })).body;
  assert.deepEqual(long.totals, { scans: 3, conversations: 2, leads: 2, qualifiedLeads: 1 });
  assert.equal(long.qualificationRate, 50, '1 qualified out of 2 leads');

  // The 30d trend includes the backdated day with its exact counts.
  const backdatedLabel = new Date(Date.now() - 10 * DAY_MS).toISOString().slice(0, 10);
  const backdatedPoint = long.trends.points.find((p) => p.date === backdatedLabel);
  assert.ok(backdatedPoint, 'backdated bucket present in the 30d trend');
  assert.equal(backdatedPoint.scans, 2);
  assert.equal(backdatedPoint.conversations, 2);
  assert.equal(backdatedPoint.leads, 2);
  assert.equal(backdatedPoint.qualifiedLeads, 1);

  // The backdated day is absent from the 7d trend.
  assert.ok(short.trends.points.every((p) => p.date !== backdatedLabel), '7d trend excludes the backdated day');
});

test('analytics are strictly isolated between tenants', async () => {
  // Each tenant only sees its own totals.
  const metricsOverview = (await request('/v1/analytics/overview?range=30d', { token: metrics.token })).body;
  assert.equal(metricsOverview.totals.scans, 1, 'metrics tenant keeps its own scan count');
  assert.equal(metricsOverview.totals.leads, 3);

  const rangesOverview = (await request('/v1/analytics/overview?range=30d', { token: ranges.token })).body;
  assert.equal(rangesOverview.totals.scans, 3);
  assert.equal(rangesOverview.totals.leads, 2);

  const emptyOverview = (await request('/v1/analytics/overview?range=30d', { token: empty.token })).body;
  assert.equal(emptyOverview.totals.scans, 0);
  assert.equal(emptyOverview.totals.leads, 0);

  // No tenant's node/agent lists leak into another tenant's.
  const rangesTouchpoints = (await request('/v1/analytics/touchpoints?range=all', { token: ranges.token })).body.touchpoints;
  assert.deepEqual(rangesTouchpoints.map((tp) => tp.name), ['range Node']);
  assert.ok(rangesTouchpoints.every((tp) => tp.name !== 'metrics Node' && tp.name !== 'empty Node'));

  const metricsAgents = (await request('/v1/analytics/agents?range=all', { token: metrics.token })).body.agents;
  assert.deepEqual(metricsAgents.map((a) => a.name), ['metrics Agent']);
  assert.ok(metricsAgents.every((a) => a.name !== 'range Agent' && a.name !== 'empty Agent'));

  // An invalid session cannot read another tenant's analytics.
  assert.equal((await request('/v1/analytics/overview', { token: ranges.token })).status, 200);
  const forged = (await request('/v1/analytics/overview', { token: 'forged-token-for-cross-tenant' })).status;
  assert.equal(forged, 401);
});
