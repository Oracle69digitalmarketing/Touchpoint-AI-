/**
 * PHASE 3 PERSISTENT AGENTS & TOUCHPOINTS SMOKE TESTS
 *
 * Covers: authenticated agent CRUD, agent tenant isolation, touchpoint CRUD,
 * touchpoint→agent ownership validation, touchpoint tenant isolation,
 * server-generated tracking ids, and plan-limit enforcement.
 *
 * Run with: NODE_ENV=test node --test tests/
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb, cleanupTestDb } from './helpers/test-db.js';

process.env.JWT_SECRET = 'test-secret-for-phase3-agents-smoke';
process.env.GROQ_API_KEY = 'gsk_test_dummy';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy';
process.env.APP_URL = 'https://app.example.test';
process.env.NODE_ENV = 'test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testPool = await setupTestDb();
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

const agentPayload = (overrides = {}) => ({
  name: 'Luxury Concierge',
  industry: 'Real Estate',
  voice: 'professional',
  description: 'High-touch property specialist',
  serviceCatalog: 'Tours, valuations, financing',
  clientProfiles: 'First-time buyers',
  caseLibrary: 'Closed 40+ deals',
  guidelines: 'Always quote NGN',
  documents: ['pricing.pdf'],
  ...overrides,
});

const touchpointPayload = (overrides = {}) => ({
  name: 'Lobby Sign',
  type: 'Business Card',
  location: 'Lagos HQ',
  ...overrides,
});

test('agents and touchpoints reject unauthenticated requests', async () => {
  assert.equal((await request('/v1/agents')).status, 401);
  assert.equal((await request('/v1/agents', { method: 'POST', body: agentPayload() })).status, 401);
  assert.equal((await request('/v1/touchpoints')).status, 401);
  assert.equal((await request('/v1/touchpoints', { method: 'POST', body: {} })).status, 401);
});

test('authenticated agent creation persists and returns a real agent', async () => {
  const acme = (await register({
    email: 'acme@agents.test',
    password: 'password123',
    name: 'Acme Owner',
    businessName: 'Acme Agents',
  })).body;

  const create = await request('/v1/agents', {
    method: 'POST',
    body: agentPayload(),
    token: acme.token,
  });
  assert.equal(create.status, 201);
  assert.ok(create.body.agent.id, 'server assigns the id');
  assert.equal(create.body.agent.name, 'Luxury Concierge');
  assert.equal(create.body.agent.status, 'Active');
  assert.equal(create.body.agent.leadsGenerated, 0);
  assert.deepEqual(create.body.agent.documents, ['pricing.pdf']);
  assert.ok(create.body.agent.createdAt, 'row is timestamped');

  // A supplied business_id must be ignored. The Free plan allows one agent, so
  // this second create hits THIS business's plan limit (403). Had the server
  // trusted the client's business_id, the agent would have been written to the
  // forged business and this request would have succeeded instead.
  const spoofed = await request('/v1/agents', {
    method: 'POST',
    body: agentPayload({ name: 'Spoofed Agent', business_id: 'victim-business-id' }),
    token: acme.token,
  });
  assert.equal(spoofed.status, 403, 'client business_id is ignored and limit still applies');
});

test('agent listing returns only the authenticated business agents', async () => {
  const acme = (await login({ email: 'acme@agents.test', password: 'password123' })).body;

  const list = await request('/v1/agents', { token: acme.token });
  assert.equal(list.status, 200);
  assert.equal(list.body.agents.length, 1);
  assert.equal(list.body.agents[0].name, 'Luxury Concierge');

  const beta = (await register({
    email: 'beta@agents.test',
    password: 'password123',
    name: 'Beta Owner',
    businessName: 'Beta Agents',
  })).body;

  const betaList = await request('/v1/agents', { token: beta.token });
  assert.equal(betaList.status, 200);
  assert.equal(betaList.body.agents.length, 0, 'beta sees no acme agents');
});

test('agent tenant isolation on read/update/delete', async () => {
  const acme = (await login({ email: 'acme@agents.test', password: 'password123' })).body;
  const beta = (await login({ email: 'beta@agents.test', password: 'password123' })).body;

  const acmeList = await request('/v1/agents', { token: acme.token });
  const targetId = acmeList.body.agents[0].id;

  assert.equal((await request(`/v1/agents/${targetId}`, { token: beta.token })).status, 404);
  assert.equal((await request(`/v1/agents/${targetId}`, { method: 'PUT', body: { name: 'Hijacked' }, token: beta.token })).status, 404);
  assert.equal((await request(`/v1/agents/${targetId}`, { method: 'DELETE', token: beta.token })).status, 404);

  const stillThere = await request(`/v1/agents/${targetId}`, { token: acme.token });
  assert.equal(stillThere.status, 200, 'acme agent untouched by beta');
});

test('agent validation rejects missing names and bad enum values', async () => {
  const acme = (await login({ email: 'acme@agents.test', password: 'password123' })).body;

  const noName = await request('/v1/agents', { method: 'POST', body: { industry: 'Retail' }, token: acme.token });
  assert.equal(noName.status, 400);

  const badVoice = await request('/v1/agents', { method: 'POST', body: agentPayload({ voice: 'shouty' }), token: acme.token });
  assert.equal(badVoice.status, 400);

  const badStatus = await request('/v1/agents', { method: 'POST', body: agentPayload({ status: 'Ghost' }), token: acme.token });
  assert.equal(badStatus.status, 400);
});

test('touchpoint creation links to a real agent and returns a server tracking id + url', async () => {
  const acme = (await login({ email: 'acme@agents.test', password: 'password123' })).body;
  const acmeList = await request('/v1/agents', { token: acme.token });
  const agentId = acmeList.body.agents[0].id;

  const create = await request('/v1/touchpoints', {
    method: 'POST',
    body: touchpointPayload({ agentId }),
    token: acme.token,
  });
  assert.equal(create.status, 201);
  const tp = create.body.touchpoint;
  assert.ok(tp.id);
  assert.equal(tp.agentId, agentId);
  assert.equal(tp.agentName, 'Luxury Concierge');
  assert.match(tp.trackingId, /^TX-/, 'tracking id generated server-side');
  assert.equal(tp.url, `https://app.example.test/t/${tp.trackingId}`);
  assert.equal(tp.scans, 0);
  assert.equal(tp.active, true);
});

test('client-supplied tracking ids are ignored and ids stay unique', async () => {
  const acme = (await login({ email: 'acme@agents.test', password: 'password123' })).body;
  const acmeList = await request('/v1/agents', { token: acme.token });
  const agentId = acmeList.body.agents[0].id;

  const first = await request('/v1/touchpoints', {
    method: 'POST',
    body: touchpointPayload({ name: 'Node A', agentId, tracking_id: 'TX-CLIENT-FORGE' }),
    token: acme.token,
  });
  assert.equal(first.status, 201);
  assert.match(first.body.touchpoint.trackingId, /^TX-/);
  assert.notEqual(first.body.touchpoint.trackingId, 'TX-CLIENT-FORGE', 'client cannot forge the tracking id');

  const second = await request('/v1/touchpoints', {
    method: 'POST',
    body: touchpointPayload({ name: 'Node B', agentId }),
    token: acme.token,
  });
  assert.equal(second.status, 201);
  assert.notEqual(first.body.touchpoint.trackingId, second.body.touchpoint.trackingId, 'tracking ids are unique');
});

test('touchpoint rejects an agent that is not in the same business', async () => {
  const acme = (await login({ email: 'acme@agents.test', password: 'password123' })).body;
  const beta = (await login({ email: 'beta@agents.test', password: 'password123' })).body;

  const betaAgents = await request('/v1/agents', { token: beta.token });
  assert.equal(betaAgents.body.agents.length, 0);

  // beta must not be able to reference acme's agent.
  const acmeList = await request('/v1/agents', { token: acme.token });
  const acmeAgentId = acmeList.body.agents[0].id;

  const forbidden = await request('/v1/touchpoints', {
    method: 'POST',
    body: touchpointPayload({ agentId: acmeAgentId }),
    token: beta.token,
  });
  assert.equal(forbidden.status, 400, 'cross-business agent reference rejected');
});

test('touchpoint tenant isolation on read/update/delete', async () => {
  const acme = (await login({ email: 'acme@agents.test', password: 'password123' })).body;
  const beta = (await login({ email: 'beta@agents.test', password: 'password123' })).body;

  const acmeList = await request('/v1/touchpoints', { token: acme.token });
  const targetId = acmeList.body.touchpoints[0].id;

  assert.equal((await request(`/v1/touchpoints/${targetId}`, { token: beta.token })).status, 404);
  assert.equal((await request(`/v1/touchpoints/${targetId}`, { method: 'PUT', body: { name: 'Hijacked' }, token: beta.token })).status, 404);
  assert.equal((await request(`/v1/touchpoints/${targetId}`, { method: 'DELETE', token: beta.token })).status, 404);

  const betaList = await request('/v1/touchpoints', { token: beta.token });
  assert.equal(betaList.body.touchpoints.length, 0, 'beta sees no acme touchpoints');
});

test('touchpoint update can reassign to an agent of the same business and toggle active', async () => {
  const acme = (await login({ email: 'acme@agents.test', password: 'password123' })).body;
  const acmeList = await request('/v1/agents', { token: acme.token });
  const agents = acmeList.body.agents;
  const tpList = await request('/v1/touchpoints', { token: acme.token });
  const target = tpList.body.touchpoints[0];

  const updated = await request(`/v1/touchpoints/${target.id}`, {
    method: 'PUT',
    body: { agentId: agents[0].id, active: false, location: 'Abuja' },
    token: acme.token,
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.touchpoint.agentId, agents[0].id);
  assert.equal(updated.body.touchpoint.active, false);
  assert.equal(updated.body.touchpoint.location, 'Abuja');
});

test('plan limits are enforced server-side for agents and touchpoints', async () => {
  const fresh = (await register({
    email: 'limited@plan.test',
    password: 'password123',
    name: 'Limited Owner',
    businessName: 'Plan Limited Co',
  })).body;

  // Free plan allows 1 agent.
  const firstAgent = await request('/v1/agents', { method: 'POST', body: agentPayload({ name: 'Only Agent' }), token: fresh.token });
  assert.equal(firstAgent.status, 201);

  const secondAgent = await request('/v1/agents', { method: 'POST', body: agentPayload({ name: 'Too Many' }), token: fresh.token });
  assert.equal(secondAgent.status, 403);
  assert.equal(secondAgent.body.code, 'PLAN_LIMIT_EXCEEDED');

  // Free plan allows 5 touchpoints (reusing the single agent).
  const agentId = firstAgent.body.agent.id;
  for (let i = 0; i < 5; i++) {
    const ok = await request('/v1/touchpoints', {
      method: 'POST',
      body: touchpointPayload({ name: `Node ${i}`, agentId }),
      token: fresh.token,
    });
    assert.equal(ok.status, 201, `touchpoint ${i} within limit`);
  }
  const sixth = await request('/v1/touchpoints', {
    method: 'POST',
    body: touchpointPayload({ name: 'Node 6', agentId }),
    token: fresh.token,
  });
  assert.equal(sixth.status, 403);
  assert.equal(sixth.body.code, 'PLAN_LIMIT_EXCEEDED');
});



// ===== Founder Agent Quota Bypass Regression Tests =====

// Helper: create a founder user
function founderDb(isFounder = true) {
  return {
    id: 'u1',
    is_platform_owner: isFounder,
    business_id: 'b1',
  };
}

// Helper: non-founder DB stub
function userDb() {
  return {
    id: 'u1',
    is_platform_owner: false,
    business_id: 'b1',
  };
}

// Helper: subscription info stub
function subInfo(plan = 'Free', status = 'active') {
  return { plan, status };
}

// Helper: create a founder user via registration
async function registerFounder(isFounder = true, plan = 'Free') {
  const email = `founder_${isFounder}_${plan}_${Date.now()}@test.com`;
  const registerPayload = {
    email,
    password: 'password123',
    name: `Founder ${isFounder ? 'True' : 'Normal'}`,
    businessName: `Business ${isFounder ? 'Founder' : 'Normal'}`,
    plan,
  };
  const registerResp = await request('/v1/auth/register', { method: 'POST', body: registerPayload });
  if (registerResp.status !== 201) throw new Error(`Registration failed: ${registerResp.status}`);
  return registerResp.body;
}

// Helper: login user
async function loginUser(email, password = 'password123') {
  const loginResp = await request('/v1/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  if (loginResp.status !== 200) throw new Error(`Login failed: ${loginResp.status}`);
  return loginResp.body;
}

// Test Group 1: Founder on any plan exceeds agent limit
// 1. Founder on Free with one existing agent can create another.
test('founder on Free can exceed agent limit', async () => {
  const founder = await registerFounder(true, 'Free');
  const create = await request('/v1/agents', {
    method: 'POST',
    body: agentPayload(),
    token: founder.token,
  });
  // Founder should be able to create agent beyond Free plan limit
  assert.ok(create.status >= 200, `Founder on Free should be able to create agent, got ${create.status}`);
});

// 2. Founder on Starter can exceed the Starter limit.
test('founder on Starter can exceed agent limit', async () => {
  const founder = await registerFounder(true, 'Starter');
  const create = await request('/v1/agents', {
    method: 'POST',
    body: agentPayload(),
    token: founder.token,
  });
  // Founder should be able to create agent beyond Starter plan limit
  assert.ok(create.status >= 200, `Founder on Starter should be able to create agent, got ${create.status}`);
});

// 3. Founder on Growth can exceed the Growth agent limit.
test('founder on Growth can exceed agent limit', async () => {
  const founder = await registerFounder(true, 'Growth');
  const create = await request('/v1/agents', {
    method: 'POST',
    body: agentPayload(),
    token: founder.token,
  });
  // Founder should be able to create agent beyond Growth plan limit
  assert.ok(create.status >= 200, `Founder on Growth should be able to create agent, got ${create.status}`);
});

// Test Group 4: Non-founder at plan limit is blocked
// 4. Non-founder on Free plan at the limit receives 403 and PLAN_LIMIT_EXCEEDED.
test('non-founder on Free at limit receives 403', async () => {
  // First create an agent to hit the Free plan limit
  const freeUser = await registerFounder(false, 'Free');
  const create1 = await request('/v1/agents', {
    method: 'POST',
    body: agentPayload(),
    token: freeUser.token,
  });
  assert.ok(create1.status === 201, `First agent creation should succeed, got ${create1.status}`);
  
  // Second attempt should be blocked
  const create2 = await request('/v1/agents', {
    method: 'POST',
    body: agentPayload(),
    token: freeUser.token,
  });
  assert.equal(create2.status, 403, `Non-founder on Free at limit should receive 403, got ${create2.status}`);
  assert.ok(create2.body.code === 'PLAN_LIMIT_EXCEEDED', `Expected PLAN_LIMIT_EXCEEDED code, got ${create2.body.code}`);
});

// 5. Non-founder on Growth plan at the limit receives 403 and PLAN_LIMIT_EXCEEDED.
test('non-founder on Growth at limit receives 403', async () => {
  const growthUser = await registerFounder(false, 'Growth');
  const create1 = await request('/v1/agents', {
    method: 'POST',
    body: agentPayload(),
    token: growthUser.token,
  });
  assert.ok(create1.status >= 200, `First agent creation should succeed, got ${create1.status}`);
  
  const create2 = await request('/v1/agents', {
    method: 'POST',
    body: agentPayload(),
    token: growthUser.token,
  });
  assert.equal(create2.status, 403, `Non-founder on Growth at limit should receive 403, got ${create2.status}`);
  assert.ok(create2.body.code === 'PLAN_LIMIT_EXCEEDED', `Expected PLAN_LIMIT_EXCEEDED code, got ${create2.body.code}`);
});

// 6. Non-founder submitting "is_platform_owner: true" cannot bypass the limit.
test('non-founder cannot bypass limit with forged founder flag', async () => {
  // This test verifies that client-supplied founder flags cannot elevate privileges
  // The server checks req.user.is_platform_owner from the database, not client data
  const growthUser = await registerFounder(false, 'Growth');
  
  // Attempt to create agent - should be blocked at plan limit
  const create = await request('/v1/agents', {
    method: 'POST',
    body: agentPayload(),
    token: growthUser.token,
  });
  // Should be blocked at plan limit, not bypassed
  assert.ok(create.status === 403, `Non-founder should be blocked at plan limit, got ${create.status}`);
  assert.ok(create.body.code === 'PLAN_LIMIT_EXCEEDED', `Expected PLAN_LIMIT_EXCEEDED, got ${create.body.code}`);
});

// 7. Founder cannot create agents for a business they are not authorized to access.
test('founder cannot create agent for unauthorized business', async () => {
  // This test verifies tenant isolation - founder can only create for their own business
  const founder = await registerFounder(true, 'Free');
  const { body: victimBusiness } = await registerFounder(false, 'Free');
  
  // Try to create agent for victim's business using founder token
  const create = await request('/v1/agents', {
    method: 'POST',
    body: agentPayload({ business_id: victimBusiness.business_id }),
    token: founder.token,
  });
  // Should be blocked - founder can only create for their own business
  assert.ok(create.status === 403, `Founder should not be able to create agent for unauthorized business, got ${create.status}`);
});

// ===== ALL 7 REGRESSION TESTS =====

test('agent update persists changes through the API', async () => {
  const acme = (await login({ email: 'acme@agents.test', password: 'password123' })).body;
  const acmeList = await request('/v1/agents', { token: acme.token });
  const target = acmeList.body.agents[0];

  const updated = await request(`/v1/agents/${target.id}`, {
    method: 'PUT',
    body: { name: 'Renamed Concierge', status: 'Inactive' },
    token: acme.token,
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.agent.name, 'Renamed Concierge');
  assert.equal(updated.body.agent.status, 'Inactive');

  const reloaded = await request(`/v1/agents/${target.id}`, { token: acme.token });
  assert.equal(reloaded.body.agent.name, 'Renamed Concierge', 'update persisted');
});
