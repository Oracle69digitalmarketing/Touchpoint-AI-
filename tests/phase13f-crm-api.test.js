/**
 * PHASE 13F-C CRM API tests
 *
 * Exercises the tenant-scoped CRM surface: enriched lead list/single reads,
 * filters + pagination, CRM status updates, assignment, notes, and the funnel
 * activity timeline — all through authenticated HTTP, never raw SQL for the
 * routes under test. Funnel event fixtures are inserted directly so lead_id /
 * conversation_id anchoring is exact.
 *
 * Runs serially (`--test-concurrency=1`) on the isolated `touchpoint_test`
 * schema. No local PostgreSQL, no `public` schema, no production data.
 */
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupTestDb, cleanupTestDb } from './helpers/test-db.js';

process.env.JWT_SECRET = 'test-secret-for-phase13f-crm-api';
process.env.GROQ_API_KEY = 'gsk_test_dummy';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy';
process.env.APP_URL = 'https://app.example.test';
process.env.NODE_ENV = 'test';

const testPool = await setupTestDb();

const { default: app, _setGroqClient, _setPaystackHttp } = await import('../server.js');

_setGroqClient({
  chat: {
    completions: {
      create: async ({ messages }) => {
        const system = (messages.find((m) => m.role === 'system') || {}).content || '';
        if (system.includes('lead qualification engine')) {
          return { choices: [{ message: { content: JSON.stringify({ name: null, phone: null, email: null, intent: null, qualificationScore: 0 }) } }] };
        }
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        return { choices: [{ message: { content: `Mock reply to: ${lastUser ? lastUser.content : ''}` } }] };
      },
    },
  },
});

_setPaystackHttp({
  async initialize({ reference, amount, email, currency }) {
    return { status: true, data: { reference, access_code: `acc_${reference}`, authorization_url: `https://checkout.paystack.com/${reference}` } };
  },
  async verify() {
    throw new Error('verify is not used by the Phase 13F CRM API suite');
  },
});

const { closeDatabase } = await import('../db-pg.js');

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://localhost:${server.address().port}`;

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
  await cleanupTestDb(testPool);
});

// ---- HTTP helpers -----------------------------------------------------------
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

const register = (payload) => request('/v1/auth/register', { method: 'POST', body: payload });
const createAgent = (token, name) =>
  request('/v1/agents', { method: 'POST', token, body: { name, industry: 'Services', voice: 'professional', description: 'CRM agent' } });
const createTouchpoint = (token, { name, agentId }) =>
  request('/v1/touchpoints', { method: 'POST', token, body: { name, type: 'Flyer', agentId } });
const createProduct = (token, product) => request('/v1/products', { method: 'POST', token, body: product });
const createLeadBody = (over) => ({
  name: 'CRM Lead', phone: '+2347000000000', email: 'lead@crm.test', ...over,
});

// ---- DB probes / fixtures ---------------------------------------------------
const insertConversation = ({ businessId, agentId, stage = 'engage', channel = 'web', customerName = null }) => {
  const id = crypto.randomUUID();
  const sql = `INSERT INTO conversations
    (id, business_id, agent_id, stage, intent, customer_need, recommended_product_id,
     buying_signal, objection, next_best_action, channel, customer_name)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id`;
  return testPool.query(sql, [id, businessId, agentId, stage, null, null, null, false, null, null, channel, customerName])
    .then((r) => r.rows[0].id);
};
const insertFunnelEvent = ({ businessId, conversationId = null, leadId = null, eventType, meta = {} }) =>
  testPool.query(
    `INSERT INTO funnel_events (id, business_id, conversation_id, lead_id, event_type, meta, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
    [crypto.randomUUID(), businessId, conversationId, leadId, eventType, JSON.stringify(meta), new Date().toISOString()]
  );

// ---- Fixtures ---------------------------------------------------------------
let bizA;
let userA;
let tokenA;
let leadA;      // linked to a conversation (the "full CRM lead")
let leadUnlink; // no conversation
let leadA2;     // for filters
let convA;      // leadA's conversation
let prodA;      // recommended product on convA

let bizB;
let tokenB;
let leadB;

before(async () => {
  // Tenant A: owner, agent, touchpoint, bookable product, leads.
  bizA = (await register({
    email: 'alice@phase13f-crm.test', password: 'password123', name: 'Alice Owner', businessName: 'CRM Alpha',
  })).body;
  tokenA = bizA.token;
  userA = bizA.user;

  const agent = (await createAgent(tokenA, 'CRM Front Desk')).body.agent;
  await createTouchpoint(tokenA, { name: 'CRM Landing', agentId: agent.id });

  prodA = (await createProduct(tokenA, { name: 'Quiet Printer', price: 12000, currency: 'NGN' })).body.product;

  // leadA: full CRM lead with a conversation carrying sales intelligence.
  convA = await insertConversation({
    businessId: bizA.business.id, agentId: agent.id, stage: 'recommend',
    channel: 'web', customerName: 'Alice A',
  });
  await testPool.query(
    `UPDATE conversations SET customer_need = $2, recommended_product_id = $3, buying_signal = TRUE, next_best_action = $4 WHERE id = $1`,
    [convA, 'Quiet home-office printer', prodA.id, 'Offer a quote']
  );
  const leadCreate = await request('/v1/leads', {
    method: 'POST', token: tokenA,
    body: createLeadBody({ name: 'Alice A', phone: '+2347111000001', email: 'alice.a@crm.test', conversationId: convA }),
  });
  assert.equal(leadCreate.status, 201, 'fixture: leadA creation');
  leadA = leadCreate.body.lead;

  leadUnlink = (await request('/v1/leads', {
    method: 'POST', token: tokenA, body: createLeadBody({ name: 'Unlinked', phone: '+2347111000002', email: 'unlinked@crm.test' }),
  })).body.lead;

  leadA2 = (await request('/v1/leads', {
    method: 'POST', token: tokenA,
    body: createLeadBody({ name: 'Beta Buyer', phone: '+2347111000003', email: 'beta@crm.test', qualificationScore: 80 }),
  })).body.lead;

  // Tenant B: independent lead.
  bizB = (await register({
    email: 'bob@phase13f-crm.test', password: 'password123', name: 'Bob Owner', businessName: 'CRM Beta',
  })).body;
  tokenB = bizB.token;
  leadB = (await request('/v1/leads', {
    method: 'POST', token: tokenB, body: createLeadBody({ name: 'Bob B', phone: '+2348222000001', email: 'bob.b@crm.test' }),
  })).body.lead;
});

// 1. Authentication: unauthenticated CRM access is rejected.
test('1. unauthenticated CRM access is rejected', async () => {
  assert.equal((await request('/v1/leads')).status, 401);
  const id = leadA.id;
  assert.equal((await request(`/v1/leads/${id}`)).status, 401);
  assert.equal((await request(`/v1/leads/${id}/crm-status`, { method: 'PUT', body: { crmStatus: 'new' } })).status, 401);
  assert.equal((await request(`/v1/leads/${id}/assignment`, { method: 'PUT', body: { assignedUserId: userA.id } })).status, 401);
  assert.equal((await request(`/v1/leads/${id}/notes`, { method: 'POST', body: { body: 'x', source: 'human' } })).status, 401);
  assert.equal((await request(`/v1/leads/${id}/notes`)).status, 401);
  assert.equal((await request(`/v1/leads/${id}/activity`)).status, 401);
});

// 2. Tenant A cannot list tenant B leads.
test('2. tenant A cannot list tenant B leads', async () => {
  const list = (await request('/v1/leads', { token: tokenA })).body;
  assert.ok(!list.leads.some((l) => l.id === leadB.id), 'tenant B lead absent from tenant A list');
  assert.ok(list.leads.some((l) => l.id === leadA.id));
});

// 3-7. Cross-tenant operations behave as not found (no existence leak).
test('3. tenant A cannot retrieve tenant B lead', async () => {
  assert.equal((await request(`/v1/leads/${leadB.id}`, { token: tokenA })).status, 404);
});
test('4. tenant A cannot update tenant B CRM status', async () => {
  assert.equal((await request(`/v1/leads/${leadB.id}/crm-status`, { method: 'PUT', token: tokenA, body: { crmStatus: 'opportunity' } })).status, 404);
});
test('5. tenant A cannot assign tenant B lead', async () => {
  assert.equal((await request(`/v1/leads/${leadB.id}/assignment`, { method: 'PUT', token: tokenA, body: { assignedUserId: userA.id } })).status, 404);
});
test('6. tenant A cannot add a note to tenant B lead', async () => {
  assert.equal((await request(`/v1/leads/${leadB.id}/notes`, { method: 'POST', token: tokenA, body: { body: 'nope', source: 'human' } })).status, 404);
  assert.equal((await request(`/v1/leads/${leadB.id}/notes`, { token: tokenA })).status, 404);
});
test('7. tenant A cannot read tenant B activity', async () => {
  assert.equal((await request(`/v1/leads/${leadB.id}/activity`, { token: tokenA })).status, 404);
});

// 8. Lead response includes CRM status.
test('8. lead response includes CRM status', async () => {
  const res = await request(`/v1/leads/${leadA.id}`, { token: tokenA });
  assert.equal(res.status, 200);
  assert.equal(res.body.lead.crmStatus, 'new');
});

// 9. Lead response includes conversation intelligence (derived, read-only).
test('9. lead response includes conversation intelligence', async () => {
  const res = await request(`/v1/leads/${leadA.id}`, { token: tokenA });
  assert.equal(res.body.lead.salesStage, 'recommend');
  assert.equal(res.body.lead.customerNeed, 'Quiet home-office printer');
  assert.ok(res.body.lead.recommendedProduct);
  assert.equal(res.body.lead.recommendedProduct.id, prodA.id);
  assert.equal(res.body.lead.buyingSignal, true);
  assert.equal(res.body.lead.nextBestAction, 'Offer a quote');
  assert.equal(res.body.lead.channel, 'web');
  assert.equal(res.body.lead.customerName, 'Alice A');
});

// 10. Conversation count is derived correctly (1 vs 0).
test('10. conversation count is correct', async () => {
  assert.equal((await request(`/v1/leads/${leadA.id}`, { token: tokenA })).body.lead.conversationCount, 1);
  assert.equal((await request(`/v1/leads/${leadUnlink.id}`, { token: tokenA })).body.lead.conversationCount, 0);
});

// 11. First/last interaction are correct (derived, never fabricated).
test('11. first/last interaction values are correct', async () => {
  const lead = (await request(`/v1/leads/${leadA.id}`, { token: tokenA })).body.lead;
  assert.equal(lead.firstInteraction, lead.createdAt, 'first interaction = lead creation');

  // Record DB-relative marks: the set_updated_at trigger in the test schema
  // overwrites any client-supplied updated_at, so timing is measured from the
  // database clock, not a future JS timestamp.
  const mark = (await testPool.query('SELECT CURRENT_TIMESTAMP AS t')).rows[0].t;
  await testPool.query(
    `INSERT INTO conversation_messages (id, conversation_id, role, text) VALUES ($1, $2, 'user', 'hello')`,
    [crypto.randomUUID(), convA]
  );
  await testPool.query(`UPDATE conversations SET customer_name = customer_name WHERE id = $1`, [convA]);

  const after = (await request(`/v1/leads/${leadA.id}`, { token: tokenA })).body.lead;
  assert.ok(
    new Date(after.lastInteraction).getTime() >= new Date(mark).getTime(),
    'last interaction reflects the conversation activity after the mark'
  );
  // No conversation linked, no events: last interaction falls back to the lead timestamp.
  const unlinked = (await request(`/v1/leads/${leadUnlink.id}`, { token: tokenA })).body.lead;
  assert.equal(unlinked.lastInteraction, unlinked.createdAt);
});

// 12. CRM status filter works.
test('12. CRM status filter works', async () => {
  assert.equal((await request(`/v1/leads/${leadA.id}/crm-status`, { method: 'PUT', token: tokenA, body: { crmStatus: 'opportunity' } })).status, 200);
  const filtered = (await request(`/v1/leads?crmStatus=opportunity`, { token: tokenA })).body;
  assert.ok(filtered.leads.some((l) => l.id === leadA.id));
  assert.ok(!filtered.leads.some((l) => l.crmStatus !== 'opportunity'));
  assert.equal((await request('/v1/leads?crmStatus=hot', { token: tokenA })).status, 400);
});

// 13. Assignment filter works.
test('13. assignment filter works', async () => {
  await request(`/v1/leads/${leadA.id}/assignment`, { method: 'PUT', token: tokenA, body: { assignedUserId: userA.id } });
  const assigned = (await request(`/v1/leads?assignedUserId=${userA.id}`, { token: tokenA })).body;
  assert.ok(assigned.leads.some((l) => l.id === leadA.id && l.assignedUser && l.assignedUser.id === userA.id));
});

// 14. Qualification filter works.
test('14. qualification filter works', async () => {
  const qualifiedLeads = (await request('/v1/leads?qualificationStatus=qualified', { token: tokenA })).body.leads;
  assert.ok(qualifiedLeads.some((l) => l.id === leadA2.id), 'score-80 lead is qualified');
  assert.ok(qualifiedLeads.every((l) => l.qualificationStatus === 'qualified'));
  assert.equal((await request('/v1/leads?qualificationStatus=bogus', { token: tokenA })).status, 400);
});

// 15. Text search works across name/phone/email.
test('15. text search works', async () => {
  assert.ok((await request(`/v1/leads?search=${encodeURIComponent('Beta Buyer')}`, { token: tokenA })).body.leads.some((l) => l.id === leadA2.id));
  assert.ok((await request(`/v1/leads?search=${encodeURIComponent('+2347111000002')}`, { token: tokenA })).body.leads.some((l) => l.id === leadUnlink.id));
  assert.ok((await request(`/v1/leads?search=${encodeURIComponent('beta@crm.test')}`, { token: tokenA })).body.leads.some((l) => l.id === leadA2.id));
});

// 16. Pagination works with bounded limits and a total.
test('16. pagination works', async () => {
  const page1 = (await request('/v1/leads?limit=2&offset=0', { token: tokenA })).body;
  assert.equal(page1.leads.length, 2);
  assert.equal(page1.total, 3);
  assert.equal(page1.limit, 2);
  assert.equal(page1.offset, 0);
  const page2 = (await request('/v1/leads?limit=2&offset=2', { token: tokenA })).body;
  assert.equal(page2.leads.length, 1);
  assert.equal(page2.total, 3);
  assert.ok(page1.leads[0].id !== page2.leads[0].id, 'offsets return different pages');

  assert.equal((await request('/v1/leads?limit=0', { token: tokenA })).status, 400);
  assert.equal((await request('/v1/leads?limit=5000', { token: tokenA })).status, 400);
  assert.equal((await request('/v1/leads?offset=-1', { token: tokenA })).status, 400);
});

// 17-19. CRM status update validity and isolation from other systems.
test('17. valid CRM status update works', async () => {
  const res = await request(`/v1/leads/${leadA.id}/crm-status`, { method: 'PUT', token: tokenA, body: { crmStatus: 'customer' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.lead.crmStatus, 'customer');
});
test('18. invalid CRM status is rejected', async () => {
  assert.equal((await request(`/v1/leads/${leadA.id}/crm-status`, { method: 'PUT', token: tokenA, body: { crmStatus: 'hot' } })).status, 400);
  assert.equal((await request(`/v1/leads/${leadA.id}/crm-status`, { method: 'PUT', token: tokenA, body: {} })).status, 400);
});
test('19. CRM status update does not mutate conversation sales stage', async () => {
  const before = (await request(`/v1/leads/${leadA.id}`, { token: tokenA })).body.lead;
  assert.equal(before.salesStage, 'recommend');
  const res = await request(`/v1/leads/${leadA.id}/crm-status`, { method: 'PUT', token: tokenA, body: { crmStatus: 'lost' } });
  assert.equal(res.status, 200);
  const after = (await request(`/v1/leads/${leadA.id}`, { token: tokenA })).body.lead;
  assert.equal(after.crmStatus, 'lost');
  assert.equal(after.salesStage, 'recommend', 'conversation stage untouched');
  assert.equal(after.qualificationStatus, 'pending', 'qualification untouched');
});

// 20-22. Assignment semantics.
test('20. same-business assignment works', async () => {
  const res = await request(`/v1/leads/${leadA2.id}/assignment`, { method: 'PUT', token: tokenA, body: { assignedUserId: userA.id } });
  assert.equal(res.status, 200);
  assert.equal(res.body.lead.assignedUser.id, userA.id);
});
test('21. cross-business assignment rejected', async () => {
  const res = await request(`/v1/leads/${leadA2.id}/assignment`, { method: 'PUT', token: tokenA, body: { assignedUserId: bizB.user.id } });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /does not belong to this business/);
});
test('22. unassignment works', async () => {
  const res = await request(`/v1/leads/${leadA2.id}/assignment`, { method: 'PUT', token: tokenA, body: { assignedUserId: null } });
  assert.equal(res.status, 200);
  assert.equal(res.body.lead.assignedUser, null);
});

// 23-27. Notes semantics.
test('23. human note works', async () => {
  const res = await request(`/v1/leads/${leadA.id}/notes`, {
    method: 'POST', token: tokenA, body: { body: 'Called and discussed pricing.', source: 'human' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.note.body, 'Called and discussed pricing.');
  assert.equal(res.body.note.source, 'human');
});
test('24. authenticated user becomes author', async () => {
  const notes = (await request(`/v1/leads/${leadA.id}/notes`, { token: tokenA })).body.notes;
  const note = notes.find((n) => n.body === 'Called and discussed pricing.');
  assert.ok(note);
  assert.equal(note.authorUserId, userA.id, 'author is the authenticated owner');
});
test('25. client cannot impersonate another author', async () => {
  const res = await request(`/v1/leads/${leadA.id}/notes`, {
    method: 'POST', token: tokenA, body: { body: 'Impersonation attempt', source: 'human', authorUserId: bizB.user.id },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.note.authorUserId, userA.id, 'authorUserId in the body is ignored');
});
test('26. invalid note source is rejected', async () => {
  assert.equal((await request(`/v1/leads/${leadA.id}/notes`, { method: 'POST', token: tokenA, body: { body: 'ai fake', source: 'ai' } })).status, 400);
  assert.equal((await request(`/v1/leads/${leadA.id}/notes`, { method: 'POST', token: tokenA, body: { body: 'alien', source: 'alien' } })).status, 400);
  assert.equal((await request(`/v1/leads/${leadA.id}/notes`, { method: 'POST', token: tokenA, body: { source: 'human' } })).status, 400);
});
test('27. cross-tenant note creation rejected', async () => {
  assert.equal((await request(`/v1/leads/${leadB.id}/notes`, { method: 'POST', token: tokenA, body: { body: 'leak', source: 'human' } })).status, 404);
});

// 28-32. Activity timeline semantics.
test('28. direct funnel_events.lead_id event appears', async () => {
  const event = (await insertFunnelEvent({ businessId: bizA.business.id, leadId: leadA.id, eventType: 'booking_reserved', meta: { slot: '10:00' } })).rows[0];
  const activity = (await request(`/v1/leads/${leadA.id}/activity`, { token: tokenA })).body.activity;
  assert.ok(activity.some((e) => e.id === event.id));
});
test('29. conversation-linked event appears', async () => {
  const event = (await insertFunnelEvent({ businessId: bizA.business.id, conversationId: convA, eventType: 'quote_requested', meta: { productId: prodA.id } })).rows[0];
  const activity = (await request(`/v1/leads/${leadA.id}/activity`, { token: tokenA })).body.activity;
  assert.ok(activity.some((e) => e.id === event.id));
});
test('30. event carrying both lead_id and conversation_id appears once', async () => {
  const event = (await insertFunnelEvent({ businessId: bizA.business.id, leadId: leadA.id, conversationId: convA, eventType: 'handoff_started', meta: {} })).rows[0];
  const activity = (await request(`/v1/leads/${leadA.id}/activity`, { token: tokenA })).body.activity;
  assert.equal(activity.filter((e) => e.id === event.id).length, 1, 'no double-counting');
});
test('31. metadata is returned safely', async () => {
  const event = (await insertFunnelEvent({ businessId: bizA.business.id, leadId: leadA.id, eventType: 'lead_field_captured', meta: { field: 'phone', key: 'probe' } })).rows[0];
  const activity = (await request(`/v1/leads/${leadA.id}/activity`, { token: tokenA })).body.activity;
  const found = activity.find((e) => e.id === event.id);
  assert.ok(found);
  assert.equal(found.eventType, 'lead_field_captured');
  assert.deepEqual(found.meta, { field: 'phone', key: 'probe' });
  assert.equal(found.conversationId, null);
  assert.equal(found.leadId, leadA.id);
});
test('32. activity timeline is tenant-isolated', async () => {
  const before = (await insertFunnelEvent({ businessId: bizB.business.id, leadId: leadB.id, eventType: 'booking_reserved', meta: {} })).rows[0];
  assert.equal((await request(`/v1/leads/${leadB.id}/activity`, { token: tokenA })).status, 404, 'another tenant lead is not found');
  const mine = (await request(`/v1/leads/${leadA.id}/activity`, { token: tokenA })).body.activity;
  assert.ok(!mine.some((e) => e.id === before.id), 'no cross-tenant event leak');
});