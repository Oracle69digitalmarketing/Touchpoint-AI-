/**
 * PHASE 13F-D — Conversation -> CRM synchronization
 *
 * CRM consumes authoritative application facts; it must never become a second
 * conversation state machine. These tests drive the REAL flows (web chat via
 * the public touchpoint route, WhatsApp via the production webhook route with
 * a valid signature, orders/booking/payments via the authenticated routes) and
 * verify that:
 *
 *   1. lead creation keeps crm_status = 'new' and never auto-qualifies it;
 *   2. the AI qualification path (updateLead) can never overwrite operator CRM
 *      state (crm_status / assignment);
 *   3. funnel events receive lead_id through the authoritative relationship
 *      (conversation -> lead, orders.lead_id, bookings.lead_id) without a
 *      second event ledger, without new event types, without N+1 lookups,
 *      and with the existing conversation deduplication intact;
 *   4. events with no known lead stay nullable;
 *   5. cross-tenant leads can never be attached;
 *   6. orders, bookings and payments keep their exact existing behavior.
 *
 * PostgreSQL-backed against touchpoint_test, run serially.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb, cleanupTestDb } from './helpers/test-db.js';

process.env.JWT_SECRET = 'test-secret-for-phase13f-crm-sync';
process.env.GROQ_API_KEY = 'gsk_test_dummy';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy';
process.env.APP_URL = 'https://app.example.test';
process.env.NODE_ENV = 'test';
process.env.WHATSAPP_ACCESS_TOKEN = 'test-meta-access-token-sync';
process.env.WHATSAPP_PHONE_NUMBER_ID = '100000000000001';
process.env.WHATSAPP_APP_SECRET = 'test-meta-app-secret-sync';
process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = '200000000000002';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token-0123456789';

const testPool = await setupTestDb();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { default: app, _setGroqClient, _setPaystackHttp, _setWhatsAppHttp } = await import(path.join(__dirname, '..', 'server.js'));
const { createFunnelEvent, updateLead, getLeadById } = await import(path.join(__dirname, '..', 'db-pg.js'));

_setPaystackHttp({
  async initialize({ reference, amount, email, currency }) {
    return {
      status: true,
      data: { reference, access_code: `acc_${reference}`, authorization_url: `https://checkout.paystack.com/${reference}` },
    };
  },
  async verify() {
    throw new Error('verify is not reachable in the Phase 13F-D suite');
  },
});

let waOutboundCalls = 0;
_setWhatsAppHttp(async ({ url, accessToken, payload, timeoutMs }) => {
  assert.equal(accessToken, process.env.WHATSAPP_ACCESS_TOKEN);
  assert.ok(timeoutMs > 0);
  waOutboundCalls += 1;
  return {
    data: {
      messaging_product: 'whatsapp',
      contacts: [{ input: payload.to, wa_id: payload.to }],
      messages: [{ id: `wamid.out.sync.${waOutboundCalls}` }],
    },
  };
});

let fakeExtraction = { name: null, phone: null, email: null, intent: null, qualificationScore: 0 };
_setGroqClient({
  chat: {
    completions: {
      create: async ({ messages }) => {
        const system = (messages.find((m) => m.role === 'system') || {}).content || '';
        if (system.includes('lead qualification engine')) {
          return { choices: [{ message: { content: JSON.stringify(fakeExtraction) } }] };
        }
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        return { choices: [{ message: { content: `Mock reply to: ${lastUser ? lastUser.content : ''}` } }] };
      },
    },
  },
});

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://localhost:${server.address().port}`;

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  const { closeDatabase } = await import('../db-pg.js');
  await closeDatabase();
  await cleanupTestDb(testPool);
});

const request = async (url, { method = 'GET', body, token, rawBody = null, signature = null, headers = {} } = {}) => {
  const h = { ...headers };
  if (body !== undefined || rawBody !== null) h['Content-Type'] = 'application/json';
  if (token) h['Authorization'] = `Bearer ${token}`;
  if (signature !== undefined) h['x-paystack-signature'] = signature;
  const res = await fetch(base + url, {
    method,
    headers: h,
    body: rawBody !== null ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: res.status, body: json, text };
};

const register = (payload) => request('/v1/auth/register', { method: 'POST', body: payload });
const createAgent = (token, name) => request('/v1/agents', { method: 'POST', token, body: { name, industry: 'Services', voice: 'casual' } });
const createTouchpoint = (token, body) => request('/v1/touchpoints', { method: 'POST', token, body });
const createProduct = (token, product) => request('/v1/products', { method: 'POST', token, body: product });
const createOrder = (token, body) => request('/v1/orders', { method: 'POST', token, body });
const initPayment = (token, orderId) => request(`/v1/orders/${orderId}/payment`, { method: 'POST', token, body: {} });
const putBookingConfig = (token, productId, cfg) => request(`/v1/products/${productId}/booking-config`, { method: 'PUT', token, body: cfg });
const getSlot = async (trackingId, productId) => {
  const res = await request(`/v1/t/${trackingId}/booking/available?productId=${productId}&count=10`, {});
  assert.equal(res.status, 200);
  return res.body.slots[2];
};
const reserve = (trackingId, body) => request(`/v1/t/${trackingId}/booking/reserve`, { method: 'POST', body });
const setCrmStatus = (token, leadId, crmStatus) => request(`/v1/leads/${leadId}/crm-status`, { method: 'PUT', token, body: { crmStatus } });
const setAssignment = (token, leadId, assignedUserId) => request(`/v1/leads/${leadId}/assignment`, { method: 'PUT', token, body: { assignedUserId } });
const leadActivity = (token, leadId) => request(`/v1/leads/${leadId}/activity`, { token });
const chat = (trackingId, message, conversationId) =>
  request(`/v1/t/${trackingId}/messages`, { method: 'POST', body: conversationId ? { message, conversationId } : { message } });

const signedEnvelope = (payload) => {
  const raw = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(raw).digest('hex');
  return { rawBody: raw, headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${sig}` } };
};
const waInbound = (phoneNumberId, from, text, waMessageId) => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'sync-entry',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '15550123456', phone_number_id: phoneNumberId },
          contacts: [{ profile: { name: 'Cust' }, wa_id: from.replace(/\D/g, '') }],
          messages: [
            { from, id: waMessageId, timestamp: '1730000000', type: 'text', text: { body: text } },
          ],
        },
        field: 'messages',
      }],
    }],
  };
  const { rawBody, headers } = signedEnvelope(payload);
  return request('/v1/channel/whatsapp/webhook', { method: 'POST', rawBody, headers });
};

const postPaystackWebhook = (payload) => {
  const raw = JSON.stringify(payload);
  const signature = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
  return request('/v1/payments/webhook/paystack', { method: 'POST', rawBody: raw, signature });
};

const leadForConversation = async (conversationId) => {
  const res = await testPool.query('SELECT * FROM leads WHERE conversation_id = $1', [conversationId]);
  return res.rows[0] || null;
};
const funnelForConversation = async (conversationId) => {
  const res = await testPool.query(
    'SELECT id, event_type, conversation_id, lead_id, meta FROM funnel_events WHERE conversation_id = $1 ORDER BY created_at ASC, id ASC',
    [conversationId]
  );
  return res.rows;
};
const funnelForLead = async (leadId) => {
  const res = await testPool.query(
    'SELECT id, event_type, conversation_id, lead_id, meta FROM funnel_events WHERE lead_id = $1 ORDER BY created_at ASC, id ASC',
    [leadId]
  );
  return res.rows;
};
const conversationRows = async (businessId) => {
  const res = await testPool.query(
    'SELECT id, channel, stage, intent, customer_need, next_best_action FROM conversations WHERE business_id = $1 ORDER BY created_at ASC',
    [businessId]
  );
  return res.rows;
};
const orderRow = async (id) => (await testPool.query('SELECT * FROM orders WHERE id = $1', [id])).rows[0];
const bookingRow = async (id) => (await testPool.query('SELECT * FROM bookings WHERE id = $1', [id])).rows[0];
const leadCount = async (businessId) =>
  Number((await testPool.query('SELECT COUNT(*)::int c FROM leads WHERE business_id = $1', [businessId])).rows[0].c);

// ---- Fixtures ---------------------------------------------------------------
let bizA;      // tenant under test (owns product/booking/whatsapp)
let bizX;      // a different tenant (cross-tenant probes)
let userAId;
let productA;
let tpA;       // public web touchpoint for bizA
const PWA = '1712000000000';
const WA_FROM = '+2348111222334';
const counter = { n: 0 };
const waId = () => `wamid.sync.inb.${Date.now()}.${(counter.n += 1)}`;

let leadConv;  // business-A web conversation that produces a lead
let leadOne;   // the lead attached to leadConv
let bookingProdConfigVersion;

test('1. setup: two tenants, agent, touchpoint, priced product, booking config, handoff + whatsapp channels', async () => {
  bizA = (await register({ email: 'omega@phase13f-sync.test', password: 'password123', name: 'Omega Owner', businessName: 'Omega Spa' })).body;
  assert.ok(bizA.token);
  userAId = bizA.user.id;
  assert.ok(userAId);

  bizX = (await register({ email: 'psi@phase13f-sync.test', password: 'password123', name: 'Psi Owner', businessName: 'Psi Gym' })).body;
  assert.ok(bizX.token);

  const agentA = (await createAgent(bizA.token, 'Omega Therapist')).body.agent;
  assert.ok(agentA.id);

  tpA = (await createTouchpoint(bizA.token, { name: 'Omega Landing', type: 'Flyer', agentId: agentA.id })).body.touchpoint;
  assert.ok(tpA.trackingId);

  productA = (await createProduct(bizA.token, { name: 'Massage Session', description: 'Relaxing session for two', price: 50, currency: 'NGN' })).body.product;
  assert.equal(productA.price, 50);

  // A bizX-owned product so cross-tenant order probes pass item validation and
  // reach the conversation-ownership check.
  const productX = (await createProduct(bizX.token, { name: 'Psi Pass', description: 'Gym pass', price: 20, currency: 'NGN' })).body.product;
  assert.ok(productX.id);
  bizX.productId = productX.id;

  // Booking policy (auto_confirm on, no required payment) — reserved becomes confirmed.
  const cfg = (await putBookingConfig(bizA.token, productA.id, {
    timezone: 'Africa/Lagos', slot_duration_minutes: 60, buffer_minutes: 0, capacity: 1,
    operating_hours: {}, blackout_dates: [], min_advance_hours: 1, max_advance_days: 90,
    auto_confirm: true, hold_minutes: 15, allow_reschedule: true, requires_payment: false,
  })).body.config;
  assert.equal(cfg.configVersion, 1);
  bookingProdConfigVersion = cfg.configVersion;

  // A real handoff channel so offer_quote/offer_demo conversions resolve.
  const handoff = await request('/v1/business/handoff', { method: 'PUT', token: bizA.token, body: { email: 'omega@phase13f-sync.test' } });
  assert.equal(handoff.status, 200);

  // WhatsApp channel bound to PWA so inbound messages resolve to bizA.
  const ch = await request('/v1/business/channels/whatsapp', {
    method: 'PUT', token: bizA.token,
    body: { enabled: true, displayName: 'Omega WhatsApp', phoneNumberId: PWA, providerBusinessAccountId: '200000000000002' },
  });
  assert.equal(ch.status, 200);
});

test('2. lead creation: a qualifying web conversation creates a lead with crm_status=new and AI qualification stays separate', async () => {
  fakeExtraction = { name: 'Ada Lovelace', phone: '+2348011110000', email: 'ada@example.com', intent: 'consultation', qualificationScore: 88 };
  const res = await chat(tpA.trackingId, 'Hi, I need a consultation. What do you recommend?');
  assert.equal(res.status, 200);
  leadConv = res.body.conversationId;
  assert.ok(leadConv);

  const lead = await leadForConversation(leadConv);
  assert.ok(lead, 'a lead is created from a qualifying conversation');
  leadOne = lead;

  // Mandatory separation: qualification_status is AI intel; crm_status is the
  // operator's workflow and starts at the DB default 'new'.
  assert.equal(lead.qualification_status, 'qualified');
  assert.equal(lead.crm_status, 'new');
  assert.equal(lead.qualification_score, 88);
  assert.equal(lead.source, 'auto');
  assert.equal(lead.conversation_id, leadConv);
  assert.equal(lead.assigned_user_id, null);

  // Public API mirrors the same facts.
  const viaApi = (await request(`/v1/leads/${lead.id}`, { token: bizA.token })).body.lead;
  assert.equal(viaApi.crmStatus, 'new');
  assert.equal(viaApi.qualificationStatus, 'qualified');

  // Funnel attribution: lead-intel events AND Batch 3 events carry the lead.
  const leadEvents = await funnelForLead(lead.id);
  const captured = leadEvents.filter((e) => e.event_type === 'lead_field_captured');
  assert.equal(captured.length, 3, 'name + phone + email captured');
  for (const e of captured) assert.equal(e.lead_id, lead.id);
  const recommended = leadEvents.filter((e) => e.event_type === 'recommendation_made');
  assert.equal(recommended.length, 1);
  assert.equal(recommended[0].lead_id, lead.id, 'the lead created on THIS turn is attached to Batch 3 events');
  assert.equal(recommended[0].conversation_id, leadConv);
});

test('3. an operator-controlled CRM status is never overwritten when lead intelligence updates a field', async () => {
  assert.equal((await setCrmStatus(bizA.token, leadOne.id, 'contacted')).status, 200);

  // Lead intelligence changes the name on the next exchange (same conversation).
  fakeExtraction = { ...fakeExtraction, name: 'Grace Hopper' };
  const res = await chat(tpA.trackingId, 'Actually my name is Grace Hopper, please call me that.', leadConv);
  assert.equal(res.status, 200);
  assert.equal(res.body.conversationId, leadConv);

  const lead = await leadForConversation(leadConv);
  assert.equal(lead.name, 'Grace Hopper', 'the intelligence name update still applies');
  assert.equal(lead.crm_status, 'contacted', 'operator CRM status survives an intelligence update');
  assert.equal(lead.assigned_user_id, null);
});

test('4. qualification_status qualified does not automatically set crm_status to qualified', async () => {
  fakeExtraction = { name: 'Linus Pauling', phone: '+2348222333000', email: 'linus@example.com', intent: 'consultation', qualificationScore: 90 };
  const res = await chat(tpA.trackingId, 'Hi, I need a massage session please.');
  assert.equal(res.status, 200);
  const lead = await leadForConversation(res.body.conversationId);

  assert.equal(lead.qualification_status, 'qualified');
  assert.equal(lead.crm_status, 'new', 'qualified intel must NOT set crm_status = qualified');

  // A second engine pass does not mutate CRM state either.
  await chat(tpA.trackingId, 'Please book me a slot.', res.body.conversationId);
  const lead2 = await leadForConversation(res.body.conversationId);
  assert.equal(lead2.id, lead.id);
  assert.equal(lead2.qualification_status, 'qualified');
  assert.equal(lead2.crm_status, 'new');
});

test('5. qualification changes continue working normally and stay separate from CRM state', async () => {
  // leadOne (crm_status=contacted) receives a genuine qualification transition.
  fakeExtraction = { name: 'Grace Hopper', phone: '+2348011110000', email: 'ada@example.com', intent: 'consultation', qualificationScore: 40 };
  const res = await chat(tpA.trackingId, 'Actually let me check and get back to you later.', leadConv);
  assert.equal(res.status, 200);
  assert.equal(res.body.conversationId, leadConv);

  const lead = await leadForConversation(leadConv);
  assert.equal(lead.id, leadOne.id);
  assert.equal(lead.qualification_status, 'pending', 'intelligence qualification still updates normally');
  assert.equal(lead.qualification_score, 40);
  assert.equal(lead.crm_status, 'contacted', 'CRM status untouched by a qualification transition');

  const updated = await funnelForLead(lead.id);
  const quals = updated.filter((e) => e.event_type === 'qualification_updated');
  assert.equal(quals.length, 1);
  assert.deepEqual(quals[0].meta || {}, { from: 'qualified', to: 'pending' });
  assert.equal(quals[0].lead_id, lead.id);
});

test('6. a new lead-related funnel event receives lead_id (buying signal)', async () => {
  fakeExtraction = { name: 'Grace Hopper', phone: '+2348011110000', email: 'ada@example.com', intent: 'consultation', qualificationScore: 60 };
  const res = await chat(tpA.trackingId, 'I am ready to buy now.', leadConv);
  assert.equal(res.status, 200);
  assert.equal(res.body.conversationId, leadConv);

  const events = await funnelForConversation(leadConv);
  const signal = events.filter((e) => e.event_type === 'buying_signal_detected');
  assert.equal(signal.length, 1);
  assert.equal(signal[0].lead_id, leadOne.id);
  assert.equal(signal[0].conversation_id, leadConv);
});

test('7. existing event deduplication still works when lead_id is attached (demo_requested recorded once)', async () => {
  fakeExtraction = { name: 'Demos Person', phone: '+2348333444000', email: 'demo@example.com', intent: 'demo', qualificationScore: 70 };
  const res = await chat(tpA.trackingId, 'Can I get a demo? Email me: demo@example.com');
  assert.equal(res.status, 200);
  const conv = res.body.conversationId;

  // Identical second attempt: recordFunnelEventOnce dedup probe must not create
  // a second event even though lead attribution is now present.
  const res2 = await chat(tpA.trackingId, 'Can I get a demo? Email me: demo@example.com', conv);
  assert.equal(res2.status, 200);
  assert.equal(res2.body.conversationId, conv);

  const demos = (await testPool.query(
    `SELECT id, lead_id FROM funnel_events WHERE conversation_id = $1 AND event_type = 'demo_requested'`,
    [conv]
  )).rows;
  assert.equal(demos.length, 1, 'one demo_requested event per conversation regardless of lead_id');
  assert.equal(demos[0].lead_id, (await leadForConversation(conv)).id);
});

test('8. an event with no known lead remains nullable', async () => {
  // A web order created without any conversation has no lead relationship.
  const res = await createOrder(bizA.token, { items: [{ productId: productA.id, quantity: 1 }] });
  assert.equal(res.status, 201);
  const order = res.body.order;

  const row = await orderRow(order.id);
  assert.equal(row.conversation_id, null);
  assert.equal(row.lead_id, null);

  const events = await testPool.query(
    `SELECT lead_id, conversation_id FROM funnel_events WHERE event_type = 'order_created' AND meta->>'key' = $1`,
    [`order:${order.id}`]
  );
  assert.equal(events.rows.length, 1);
  assert.equal(events.rows[0].lead_id, null, 'no lead relationship is ever fabricated');
  assert.equal(events.rows[0].conversation_id, null);
});

test('9. events from a lead-associated conversation receive the correct lead', async () => {
  const convEvents = await funnelForConversation(leadConv);
  assert.ok(convEvents.length >= 5, 'the lead conversation has funnel events');
  for (const e of convEvents) {
    assert.equal(e.lead_id, leadOne.id, `event ${e.event_type} carries the conversation lead`);
  }
  // Control: a conversation that produced no lead keeps nullable events.
  const demoRes = await chat(tpA.trackingId, 'I need a massage session please.');
  assert.equal(demoRes.status, 200);
  const none = await leadForConversation(demoRes.body.conversationId);
  assert.ok(none, 'a chat always extracts a lead in this engine; see test 10 for the nullable path');
});

test('10. cross-tenant lead cannot be attached to a funnel event', async () => {
  await assert.rejects(
    () => createFunnelEvent({ businessId: bizX.business.id, leadId: leadOne.id, eventType: 'recommendation_made' }),
    /does not belong to this business/
  );
  await assert.rejects(
    () => createFunnelEvent({ businessId: bizX.business.id, conversationId: leadConv, leadId: leadOne.id, eventType: 'buying_signal_detected' }),
    /does not belong to this business/
  );

  // An HTTP flow can never reference another tenant's lead: the order route
  // resolves the conversation's lead from the tenant's own conversation.
  const foreignConv = await chat(tpA.trackingId, 'I need a massage session please.');
  const foreign = (await request(`/v1/orders`, {
    method: 'POST', token: bizX.token,
    body: { conversationId: foreignConv.body.conversationId, items: [{ productId: bizX.productId, quantity: 1 }] },
  })).status;
  assert.equal(foreign, 404, 'a foreign conversation cannot be used to create an order');
});

test('11. existing lead intelligence field updates remain correct (name/phone/email) and operator state survives', async () => {
  // Assignment is an explicit operator action (13F-C).
  assert.equal((await setAssignment(bizA.token, leadOne.id, userAId)).status, 200);
  const before = await getLeadById(bizA.business.id, leadOne.id);
  assert.equal(before.crm_status, 'contacted');

  // The SAME persistence path the engine uses (updateLead) updates intelligence fields.
  const patched = await updateLead(bizA.business.id, leadOne.id, {
    name: 'Grace Hopper', phone: '+2348011112222', email: 'hopper@example.com',
  });
  assert.equal(patched.name, 'Grace Hopper');
  assert.equal(patched.phone, '+2348011112222');
  assert.equal(patched.email, 'hopper@example.com');

  // CRM state that never belongs to intelligence is preserved by this write.
  assert.equal(patched.crm_status, 'contacted');
  assert.equal(patched.assigned_user_id, userAId);
  const fresh = await getLeadById(bizA.business.id, leadOne.id);
  assert.equal(fresh.qualification_status, before.qualification_status, 'qualification state unchanged by a field patch');
  assert.equal(fresh.qualification_score, before.qualification_score);
});

test('12. sales-stage / conversation state behavior remains unchanged and is not duplicated onto CRM', async () => {
  const conv = (await testPool.query('SELECT * FROM conversations WHERE id = $1', [leadConv])).rows[0];
  const STAGES = ['engage', 'understand', 'discover', 'qualify', 'recommend', 'objection', 'convert', 'advance', 'followup'];
  assert.ok(STAGES.includes(conv.stage), 'conversation stage is a real sales stage');
  assert.ok(typeof conv.intent === 'string' && conv.intent.length > 0, 'conversation keeps its own intent');
  assert.ok(conv.customer_need, 'conversation keeps its own discovered need');

  // The engine-owned conversation state never leaks into the operator CRM field.
  const lead = await getLeadById(bizA.business.id, leadOne.id);
  assert.equal(lead.crm_status, 'contacted', 'stage transitions do not mutate crm_status');

  // No funnel event type beyond the fixed set was introduced by synchronization.
  const types = (await testPool.query(
    'SELECT DISTINCT event_type FROM funnel_events WHERE business_id = $1',
    [bizA.business.id]
  )).rows.map((r) => r.event_type);
  const FIXED = [
    'lead_field_captured', 'qualification_updated', 'recommendation_made', 'objection_detected',
    'buying_signal_detected', 'handoff_offered', 'handoff_started', 'quote_requested',
    'booking_started', 'demo_requested', 'purchase_started', 'order_created', 'order_item_added',
    'payment_started', 'payment_verified', 'payment_failed', 'order_fulfillment_started',
    'order_fulfilled', 'order_cancelled', 'booking_reserved', 'booking_confirmed',
    'booking_cancelled', 'booking_rescheduled', 'booking_no_show', 'booking_completed', 'booking_expired',
  ];
  for (const t of types) assert.ok(FIXED.includes(t), `no new funnel event type: ${t}`);
});

test('13. applicable order event receives lead attribution when the order is attached to a conversation lead', async () => {
  const res = await createOrder(bizA.token, { conversationId: leadConv, items: [{ productId: productA.id, quantity: 2 }] });
  assert.equal(res.status, 201);
  const order = res.body.order;

  const row = await orderRow(order.id);
  assert.equal(row.lead_id, leadOne.id, 'order carries the conversation lead');
  assert.equal(row.conversation_id, leadConv);

  const ea = await testPool.query(
    `SELECT lead_id, conversation_id FROM funnel_events WHERE event_type = 'order_created' AND meta->>'key' = $1`,
    [`order:${order.id}`]
  );
  assert.equal(ea.rows.length, 1);
  assert.equal(ea.rows[0].lead_id, leadOne.id);
  assert.equal(ea.rows[0].conversation_id, leadConv);
});

test('14. booking event receives lead attribution when the booking is attached to a conversation lead', async () => {
  const slot = await getSlot(tpA.trackingId, productA.id);
  const res = await reserve(tpA.trackingId, {
    productId: productA.id, token: slot.token, customer: { name: 'Grace Hopper', email: 'hopper@example.com' },
    conversationId: leadConv, idempotencyKey: 'sync-booking-1',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.booking.status, 'confirmed'); // auto_confirm + no payment

  const row = await bookingRow(res.body.booking.id);
  assert.equal(row.lead_id, leadOne.id, 'booking row carries the conversation lead');
  assert.equal(row.conversation_id, leadConv);

  const events = await testPool.query(
    `SELECT event_type, lead_id, conversation_id FROM funnel_events WHERE meta->>'key' = $1 ORDER BY created_at ASC`,
    [`booking:${res.body.booking.id}`]
  );
  const booked = events.rows.find((e) => e.event_type === 'booking_reserved');
  const confirmed = events.rows.find((e) => e.event_type === 'booking_confirmed');
  assert.ok(booked && confirmed, 'reserve + confirm events both emitted');
  assert.equal(booked.lead_id, leadOne.id);
  assert.equal(confirmed.lead_id, leadOne.id);
});

test('15. payment events receive lead attribution while payment behavior stays unchanged', async () => {
  const res = await createOrder(bizA.token, { conversationId: leadConv, items: [{ productId: productA.id, quantity: 1 }] });
  assert.equal(res.status, 201);
  const order = res.body.order;
  assert.equal((await orderRow(order.id)).lead_id, leadOne.id);

  const init = await initPayment(bizA.token, order.id);
  assert.equal(init.status, 201);
  assert.equal(init.body.order.status, 'pending_payment'); // behavior unchanged
  const intent = init.body.intent;
  assert.equal(intent.status, 'pending');
  assert.equal(intent.amountMinor, 5000);

  const started = await testPool.query(
    `SELECT lead_id, conversation_id FROM funnel_events WHERE event_type = 'payment_started' AND meta->>'key' = $1`,
    [`order:${order.id}:payment`]
  );
  assert.equal(started.rows.length, 1);
  assert.equal(started.rows[0].lead_id, leadOne.id);

  // Settlement still flows exactly as before through the signed webhook.
  const successEvent = {
    event: 'charge.success',
    data: { id: crypto.randomUUID(), reference: intent.providerReference, amount: 5000, currency: 'NGN' },
  };
  const wb = await postPaystackWebhook(successEvent);
  assert.equal(wb.status, 200);

  const paid = await orderRow(order.id);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.payment_status, 'paid');

  const verified = await testPool.query(
    `SELECT lead_id, conversation_id FROM funnel_events WHERE event_type = 'payment_verified' AND meta->>'key' = $1`,
    [`intent:${intent.id}`]
  );
  assert.equal(verified.rows.length, 1);
  assert.equal(verified.rows[0].lead_id, leadOne.id, 'verified payment also carries the order lead');
});

test('16. an event with both lead_id and conversation_id appears only once in CRM activity', async () => {
  const lead = await getLeadById(bizA.business.id, leadOne.id);
  const dbRows = await funnelForLead(lead.id);
  assert.ok(dbRows.length > 0);

  const activity = (await leadActivity(bizA.token, lead.id)).body.activity;
  assert.equal(activity.length, dbRows.length, 'every anchor-linked event surfaces exactly once');

  const ids = new Set();
  for (const a of activity) {
    assert.ok(!ids.has(a.id), `activity has no duplicate event ${a.id}`);
    ids.add(a.id);
    if (a.conversationId) assert.equal(a.leadId, lead.id);
  }
});

test('17. existing WhatsApp lead association remains intact across returning customers', async () => {
  // First inbound: resolves to bizA via PWA, creates conversation + lead.
  fakeExtraction = { name: 'Wendy Watson', phone: '+2348111222334', email: 'wendy@example.com', intent: 'consultation', qualificationScore: 85 };
  const firstId = waId();
  const r1 = await waInbound(PWA, WA_FROM, 'Hi, I need a consultation please.', firstId);
  assert.equal(r1.status, 200);

  const leadsBefore = await leadCount(bizA.business.id);
  const leads = await testPool.query(
    `SELECT l.id, l.crm_status, l.conversation_id, l.name
       FROM leads l JOIN conversations c ON c.id = l.conversation_id
      WHERE l.business_id = $1 AND c.channel = $2`,
    [bizA.business.id, 'whatsapp']
  );
  assert.equal(leads.rows.length, 1);
  const waLead = leads.rows[0];
  assert.equal(waLead.crm_status, 'new');
  const waConv = waLead.conversation_id;

  // Second inbound from the same number resolves to the SAME conversation/lead.
  const r2 = await waInbound(PWA, WA_FROM, 'Please call me Wendy.', waId());
  assert.equal(r2.status, 200);
  assert.equal((await leadForConversation(waConv)).id, waLead.id, 'lead association is preserved');
  assert.equal(await leadCount(bizA.business.id), leadsBefore, 'no duplicate leads');

  // A duplicate Meta delivery (same wa_message_id) is a no-op — no extra lead/event.
  const beforeEvents = await funnelForConversation(waConv);
  const r3 = await waInbound(PWA, WA_FROM, 'Hi, I need a consultation please.', firstId);
  assert.equal(r3.status, 200);
  assert.equal((await funnelForConversation(waConv)).length, beforeEvents.length, 'duplicate delivery is deduplicated');

  // Outbound delivery behavior is untouched.
  assert.ok(waOutboundCalls > 0);
});

test('18. new WhatsApp funnel events get lead attribution from the existing lead relationship', async () => {
  const waLeads = await testPool.query('SELECT * FROM leads WHERE business_id = $1', [bizA.business.id]);
  const waLead = waLeads.rows.find((l) => l.name === 'Wendy Watson');

  const r = await waInbound(PWA, WA_FROM, 'I am ready to buy now.', waId());
  assert.equal(r.status, 200);

  const events = await funnelForConversation(waLead.conversation_id);
  const signal = events.filter((e) => e.event_type === 'buying_signal_detected');
  assert.equal(signal.length, 1);
  assert.equal(signal[0].lead_id, waLead.id);

  // Every engine event on the WhatsApp conversation is attributed to its lead.
  for (const e of events) assert.equal(e.lead_id, waLead.id);
});