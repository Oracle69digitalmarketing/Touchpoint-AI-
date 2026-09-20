/**
 * PHASE 13A COMMERCIAL TRANSACTIONS tests
 *
 * Deterministic commercial foundation:
 *
 *   - orders + order_items: the server computes every monetary figure from the
 *     authoritative product catalog; the request body can never set status,
 *     money or payment state; status moves only through a compare-and-set state
 *     machine (draft -> pending_payment -> paid -> fulfillment_pending ->
 *     fulfilled, with cancellation; paid/fulfilled are LOCKED in this phase);
 *   - commercial actions: the AI may only propose, proposals are always stored
 *     'proposed', and only the server executes them after deterministic
 *     validation (START_ORDER backed by a real order; everything else 409);
 *   - channel boundary: one shared conversation engine for web and whatsapp,
 *     deterministic channel identity, and a clearly-labeled mock outbound;
 *   - channel configuration holds only public fields; credential-shaped keys
 *     are rejected outright;
 *   - commercial funnel events reuse the tenant-scoped Phase 12 model and are
 *     deduped per order.
 *
 * The Groq client is swapped for a deterministic fake via the _setGroqClient
 * seam, so no live API key is needed. PostgreSQL-backed against touchpoint_test.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb, cleanupTestDb } from './helpers/test-db.js';

process.env.JWT_SECRET = 'test-secret-for-phase13a-commerce';
process.env.GROQ_API_KEY = 'gsk_test_dummy';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy';
process.env.APP_URL = 'https://app.example.test';
process.env.NODE_ENV = 'test';
process.env.WHATSAPP_ACCESS_TOKEN = 'test-meta-access-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '100000000000001';
process.env.WHATSAPP_APP_SECRET = 'test-meta-app-secret';
process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = '200000000000002';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token-0123456789';

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

const { default: app, _setGroqClient, _setPaystackHttp, _setWhatsAppHttp } = await import(path.join(__dirname, '..', 'server.js'));

// Phase 13B: the payment-init path lives behind the provider HTTP seam. The
// fake transport returns an authoritative checkout without any network call;
// production always uses the real Paystack API.
_setPaystackHttp({
  async initialize({ reference, amount, email, currency }) {
    return {
      status: true,
      data: {
        reference,
        access_code: `acc_${reference}`,
        authorization_url: `https://checkout.paystack.com/${reference}`,
      },
    };
  },
  async verify() {
    throw new Error('verify is not used by the Phase 13A suite');
  },
});

// Phase 13D-Batch A: WhatsApp outbound goes through the real adapter with the
// transport substituted — production always calls the real Meta Graph API.
let waOutboundCalls = 0;
_setWhatsAppHttp(async ({ accessToken, payload, timeoutMs }) => {
  assert.equal(accessToken, process.env.WHATSAPP_ACCESS_TOKEN);
  assert.ok(timeoutMs > 0);
  waOutboundCalls += 1;
  return {
    data: {
      messaging_product: 'whatsapp',
      contacts: [{ input: payload.to, wa_id: payload.to }],
      messages: [{ id: `wamid.out.p13a.${waOutboundCalls}` }],
    },
  };
});

const capturedSystemPrompts = [];
let fakeExtraction = { name: null, phone: null, email: null, intent: null, qualificationScore: 0 };

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
        return {
          choices: [{ message: { content: `Mock reply to: ${lastUser ? lastUser.content : ''}` } }],
        };
      },
    },
  },
});

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://localhost:${server.address().port}`;

after(async () => {
  server.close();
  await cleanupTestDb(testPool);
});

const request = async (url, { method = 'GET', body, token, raw = false, rawBody = null, headers: extraHeaders = {} } = {}) => {
  const headers = { ...extraHeaders };
  if (body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(base + url, {
    method,
    headers,
    body: rawBody !== null ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (raw) return { status: res.status, text: await res.text() };
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
};

const register = (payload) => request('/v1/auth/register', { method: 'POST', body: payload });

const createProduct = (token, product) =>
  request('/v1/products', { method: 'POST', token, body: product });

const createOrder = (token, body) => request('/v1/orders', { method: 'POST', token, body });

const funnelRowsFor = async (conversationId) => {
  const res = await testPool.query(
    'SELECT event_type, meta FROM funnel_events WHERE conversation_id = $1 ORDER BY created_at',
    [conversationId]
  );
  return res.rows;
};

// Fixtures
let businessA; // the tenant that owns products/orders
let businessB; // a different tenant (cross-tenant probes)
let agentAId;
let agentBId;
let productA;   // active product
let productB;   // inactive product
let productC;   // second active product (for multi-line orders)
let productCross; // active product owned by businessB
let conversationA;

test('setup: register two tenants and create agents, touchpoints and products', async () => {
  businessA = (await register({
    email: 'iota@phase13a.test',
    password: 'password123',
    name: 'Iota Owner',
    businessName: 'Iota Bakery',
  })).body;
  assert.ok(businessA.token);

  businessB = (await register({
    email: 'kappa@phase13a.test',
    password: 'password123',
    name: 'Kappa Owner',
    businessName: 'Kappa Coffee',
  })).body;

  agentAId = (await request('/v1/agents', {
    method: 'POST',
    token: businessA.token,
    body: { name: 'Iota Baker', industry: 'Food', voice: 'casual', description: 'Fresh bread' },
  })).body.agent.id;

  agentBId = (await request('/v1/agents', {
    method: 'POST',
    token: businessB.token,
    body: { name: 'Kappa Barista', industry: 'Food', voice: 'casual' },
  })).body.agent.id;

  const tp = (await request('/v1/touchpoints', {
    method: 'POST',
    token: businessA.token,
    body: { name: 'Iota Storefront', type: 'Flyer', agentId: agentAId },
  })).body.touchpoint;
  assert.ok(tp.id);

  productA = (await createProduct(businessA.token, {
    name: 'Sourdough Loaf',
    description: 'Daily bake',
    price: 8.5,
    currency: 'NGN',
  })).body.product;
  assert.equal(productA.price, 8.5);

  productB = (await createProduct(businessA.token, {
    name: 'Sourdough Starter',
    price: 20,
    status: 'inactive',
  })).body.product;
  assert.equal(productB.status, 'inactive');

  productC = (await createProduct(businessA.token, {
    name: 'Croissant',
    price: 20,
  })).body.product;
  assert.equal(productC.price, 20);

  productCross = (await createProduct(businessB.token, {
    name: 'Espresso',
    price: 5,
  })).body.product;
});

test('1. order creation uses authoritative product prices — client money, status and payment fields are ignored', async () => {
  const res = await createOrder(businessA.token, {
    items: [
      { productId: productA.id, quantity: 3 },
      { productId: productA.id, quantity: 1 },
    ],
    status: 'paid',
    paymentStatus: 'paid',
    subtotal: 1,
    total: 1,
    currency: 'NGN',
  });
  assert.equal(res.status, 201);
  const order = res.body.order;
  // Server computes: 8.5 * (3+1) from the authoritative product price.
  assert.equal(order.subtotal, 34);
  assert.equal(order.total, 34);
  assert.equal(order.status, 'draft');
  assert.equal(order.paymentStatus, 'unpaid');
  assert.equal(order.fulfillmentStatus, 'unfulfilled');
  assert.equal(order.items.length, 1); // duplicate lines are deduped
  assert.equal(order.items[0].quantity, 4);
  assert.equal(order.items[0].unitPrice, 8.5);
});

test("2. orders are tenant-scoped: another tenant can never see or use this tenant's order", async () => {
  const ordersA = (await request('/v1/orders', { token: businessA.token })).body.orders;
  const ordersB = (await request('/v1/orders', { token: businessB.token })).body.orders;
  assert.ok(ordersA.length >= 1);
  assert.equal(ordersB.length, 0);

  const first = ordersA[0];
  const crossFetch = await request(`/v1/orders/${first.id}`, { token: businessB.token });
  assert.equal(crossFetch.status, 404);
});

test('3. a business cannot order a product it does not own, or an inactive product', async () => {
  const foreign = await createOrder(businessA.token, { items: [{ productId: productCross.id, quantity: 1 }] });
  assert.equal(foreign.status, 400);

  const inactive = await createOrder(businessA.token, { items: [{ productId: productB.id, quantity: 1 }] });
  assert.equal(inactive.status, 400);
});

test('4. invalid order item payloads are rejected (empty, bad quantity, missing items)', async () => {
  assert.equal((await createOrder(businessA.token, { items: [] })).status, 400);
  assert.equal((await createOrder(businessA.token, { items: [{ productId: productA.id, quantity: 0 }] })).status, 400);
  assert.equal((await createOrder(businessA.token, { items: [{ productId: productA.id, quantity: 1.5 }] })).status, 400);
  assert.equal((await createOrder(businessA.token, { items: [{ productId: productA.id, quantity: 10001 }] })).status, 400);
  assert.equal((await createOrder(businessA.token, {})).status, 400);
});

test('5. order lifecycle: draft -> pending_payment, then items are locked; pending_payment -> cancelled', async () => {
  const created = (await createOrder(businessA.token, { items: [{ productId: productA.id, quantity: 1 }] })).body.order;
  assert.equal(created.status, 'draft');

  // start-payment was superseded in 13B by POST /v1/orders/:id/payment: it
  // creates the live payment intent and moves draft -> pending_payment
  // (payment becomes 'pending', never 'paid').
  const started = await request(`/v1/orders/${created.id}/payment`, { method: 'POST', token: businessA.token });
  assert.equal(started.status, 201);
  assert.equal(started.body.order.status, 'pending_payment');
  assert.equal(started.body.order.paymentStatus, 'pending');
  assert.equal(started.body.intent.status, 'pending');
  assert.equal(started.body.intent.amountMinor, 850); // 8.5 NGN -> integer kobo
  assert.ok(started.body.intent.checkout.authorizationUrl);

  // items are only addable while draft
  const addItem = await request(`/v1/orders/${created.id}/items`, {
    method: 'POST',
    token: businessA.token,
    body: { items: [{ productId: productB.id, quantity: 1 }] },
  });
  assert.equal(addItem.status, 409);

  // cancel a pending_payment order
  const cancelled = await request(`/v1/orders/${created.id}/cancel`, { method: 'POST', token: businessA.token });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.order.status, 'cancelled');
  assert.equal(cancelled.body.order.paymentStatus, 'pending');
});

test('6. invalid transitions are rejected (cancel->cancel, cancelled->payment)', async () => {
  const created = (await createOrder(businessA.token, { items: [{ productId: productA.id, quantity: 1 }] })).body.order;
  const cancelled = await request(`/v1/orders/${created.id}/cancel`, { method: 'POST', token: businessA.token });
  assert.equal(cancelled.status, 200);

  const doubleCancel = await request(`/v1/orders/${created.id}/cancel`, { method: 'POST', token: businessA.token });
  assert.equal(doubleCancel.status, 409);
  assert.equal(doubleCancel.body.code, 'INVALID_TRANSITION');

  const payAfterCancel = await request(`/v1/orders/${created.id}/payment`, { method: 'POST', token: businessA.token });
  assert.equal(payAfterCancel.status, 409);

  // missing order -> 404
  assert.equal((await request('/v1/orders/does-not-exist/cancel', { method: 'POST', token: businessA.token })).status, 404);
});

test('7. items endpoint: adds a line to a draft order, recomputes totals, rejects duplicates', async () => {
  const created = (await createOrder(businessA.token, { items: [{ productId: productA.id, quantity: 2 }] })).body.order;
  assert.equal(created.total, 17);

  const add = await request(`/v1/orders/${created.id}/items`, {
    method: 'POST',
    token: businessA.token,
    body: { items: [{ productId: productA.id, quantity: 1 }] },
  });
  assert.equal(add.status, 409); // already on the order
  assert.equal(add.body.code, 'DUPLICATE_LINE');

  const added = await request(`/v1/orders/${created.id}/items`, {
    method: 'POST',
    token: businessA.token,
    body: { items: [{ productId: productC.id, quantity: 10 }] },
  });
  assert.equal(added.status, 200);
  assert.equal(added.body.order.total, 217);
  assert.equal(added.body.order.items.length, 2);
});

test('8. orders can be bound to a conversation owned by the tenant', async () => {
  const touchpoint = (await request('/v1/touchpoints', {
    method: 'POST',
    token: businessA.token,
    body: { name: 'Iota Landing', type: 'Flyer', agentId: agentAId },
  })).body.touchpoint;

  const chat = await request(`/v1/t/${touchpoint.trackingId}/messages`, {
    method: 'POST',
    body: { message: 'I want to order bread', customerName: 'Ada', targetLanguage: 'en' },
  });
  assert.equal(chat.status, 200);
  conversationA = chat.body.conversationId;

  const created = (await createOrder(businessA.token, {
    conversationId: conversationA,
    items: [{ productId: productA.id, quantity: 1 }],
  })).body.order;
  assert.equal(created.conversationId, conversationA);

  const events = await funnelRowsFor(conversationA);
  const types = events.map((e) => e.event_type);
  assert.ok(types.includes('order_created'));
});

test('9. commercial actions: propose is validated and ALWAYS stored proposed (status cannot be set)', async () => {
  const bad = await request('/v1/commercial/actions/propose', {
    method: 'POST',
    token: businessA.token,
    body: { actionType: 'ROB_CLAIM' },
  });
  assert.equal(bad.status, 400);

  const noConversation = await request('/v1/commercial/actions/propose', {
    method: 'POST',
    token: businessA.token,
    body: { actionType: 'START_ORDER', conversationId: 'missing' },
  });
  assert.equal(noConversation.status, 404);

  const foreignProduct = await request('/v1/commercial/actions/propose', {
    method: 'POST',
    token: businessA.token,
    body: { actionType: 'REQUEST_QUOTE', productId: productCross.id },
  });
  assert.equal(foreignProduct.status, 400);

  const res = await request('/v1/commercial/actions/propose', {
    method: 'POST',
    token: businessA.token,
    body: {
      actionType: 'REQUEST_QUOTE',
      conversationId: conversationA,
      productId: productA.id,
      status: 'executed', // the AI/client claims execution — must be ignored
      customer: { name: 'Ada', phone: '+23480123', email: 'ada@example.com' },
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.action.status, 'proposed');
  assert.equal(res.body.action.actionType, 'REQUEST_QUOTE');
  assert.equal(res.body.action.customer.name, 'Ada');
});

test('10. commercial actions: execution is server-only and deterministic', async () => {
  // START_ORDER with no backing order -> not executable (use a fresh
  // conversation that has no order yet).
  const freshTp = (await request('/v1/touchpoints', {
    method: 'POST',
    token: businessA.token,
    body: { name: 'Iota Actions', type: 'Flyer', agentId: agentAId },
  })).body.touchpoint;
  const freshChat = await request(`/v1/t/${freshTp.trackingId}/messages`, {
    method: 'POST',
    body: { message: 'I need a quote', customerName: 'Ngozi', targetLanguage: 'en' },
  });
  assert.equal(freshChat.status, 200);
  const freshConversation = freshChat.body.conversationId;

  const unbacked = await request('/v1/commercial/actions/propose', {
    method: 'POST',
    token: businessA.token,
    body: { actionType: 'START_ORDER', conversationId: freshConversation },
  });
  const unbackedAction = unbacked.body.action;
  const execNo = await request(`/v1/commercial/actions/${unbackedAction.id}/execute`, { method: 'POST', token: businessA.token });
  assert.equal(execNo.status, 409);
  assert.equal(execNo.body.code, 'ACTION_NOT_EXECUTABLE');

  // Create a real order for that conversation, then the action can execute
  await createOrder(businessA.token, { conversationId: freshConversation, items: [{ productId: productA.id, quantity: 1 }] });
  const execYes = await request(`/v1/commercial/actions/${unbackedAction.id}/execute`, { method: 'POST', token: businessA.token });
  assert.equal(execYes.status, 200);
  assert.equal(execYes.body.action.status, 'executed');
  assert.ok(execYes.body.action.orderId);

  // already-executed action cannot re-execute
  const again = await request(`/v1/commercial/actions/${unbackedAction.id}/execute`, { method: 'POST', token: businessA.token });
  assert.equal(again.status, 409);
});

test('11. non-backed action types cannot be executed in Phase 13A', async () => {
  for (const actionType of ['REQUEST_QUOTE', 'BOOK', 'START_PAYMENT', 'REQUEST_DEMO', 'TALK_TO_HUMAN']) {
    const proposed = (await request('/v1/commercial/actions/propose', {
      method: 'POST',
      token: businessA.token,
      body: { actionType, conversationId: conversationA },
    })).body.action;
    assert.equal(proposed.status, 'proposed');
    const exec = await request(`/v1/commercial/actions/${proposed.id}/execute`, { method: 'POST', token: businessA.token });
    assert.equal(exec.status, 409);
    assert.equal(exec.body.code, 'ACTION_NOT_EXECUTABLE');
  }

  // cross-tenant action id is not visible
  const foreign = (await request('/v1/commercial/actions/propose', {
    method: 'POST',
    token: businessB.token,
    body: { actionType: 'REQUEST_QUOTE' },
  })).body.action;
  const crossTenant = await request(`/v1/commercial/actions/${foreign.id}/execute`, { method: 'POST', token: businessA.token });
  assert.equal(crossTenant.status, 404);
});

test('12. whatsapp inbound: SAME engine and reply, deterministic channel identity, real outbound contract', async () => {
  // Bind business B's WhatsApp channel to a Meta phone number id (public
  // identifier, never a secret — the same boundary Phase 13A enforces).
  const PHONE_B = '17000000000002';
  const bind = await request('/v1/business/channels/whatsapp', {
    method: 'PUT',
    token: businessB.token,
    body: { enabled: true, phoneNumberId: PHONE_B },
  });
  assert.equal(bind.status, 200);

  const sign = (payload) => {
    const raw = JSON.stringify(payload);
    const sig = crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(raw).digest('hex');
    return { rawBody: raw, headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${sig}` } };
  };
  const webhook = (payload) => {
    const { rawBody, headers } = sign(payload);
    return request('/v1/channel/whatsapp/webhook', { method: 'POST', rawBody, headers });
  };
  const waEnv = (number, text, waMessageId) => ({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'p13a-entry',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '15550123456', phone_number_id: PHONE_B },
          contacts: [{ profile: { name: 'Cust' }, wa_id: number.replace(/\D/g, '') }],
          messages: [{ from: number, id: waMessageId, timestamp: '1730000000', type: 'text', text: { body: text } }],
        },
        field: 'messages',
      }],
    }],
  });
  let waSeq = 0;
  const nextWaId = () => `wamid.p13a.inb.${Date.now()}.${(waSeq += 1)}`;

  // First contact creates a whatsapp-channel conversation with NO touchpoint.
  const first = await webhook(waEnv('+2348000000001', 'Hi', nextWaId()));
  assert.equal(first.status, 200);
  assert.equal(first.body.received, true);

  // The ledger proves the real outbound contract: Meta accepted (returned an
  // id) before status 'sent' is recorded.
  const ledger = (await testPool.query(
    'SELECT direction, status, body, wa_message_id FROM whatsapp_messages WHERE business_id = $1 ORDER BY created_at, id',
    [businessB.business.id]
  )).rows;
  assert.equal(ledger.filter((r) => r.direction === 'inbound').length, 1);
  const outbound = ledger.find((r) => r.direction === 'outbound');
  assert.ok(outbound);
  assert.equal(outbound.status, 'sent');
  assert.equal(outbound.wa_message_id, 'wamid.out.p13a.1');
  assert.equal(outbound.body, 'Mock reply to: Hi');

  const firstBody = await request('/v1/conversations', { token: businessB.token });
  const convs = firstBody.body.conversations;
  const convIdsSince = convs.length;
  const conv = convs.find((c) => c.channel === 'whatsapp');
  assert.ok(conv);
  assert.equal(conv.touchpointId, null);
  assert.equal(conv.channel, 'whatsapp');

  // Second message from the same sender reuses the SAME conversation (identity).
  const second = await webhook(waEnv('+2348000000001', 'Again', nextWaId()));
  assert.equal(second.status, 200);
  const afterSecond = (await request('/v1/conversations', { token: businessB.token })).body.conversations;
  assert.equal(afterSecond.length, convIdsSince, 'no new conversation for the same sender');
  assert.equal(afterSecond.find((c) => c.channel === 'whatsapp').id, conv.id);

  // A different sender resolves to a DIFFERENT conversation.
  const other = await webhook(waEnv('+2348000000002', 'Hello', nextWaId()));
  assert.equal(other.status, 200);
  const afterOther = (await request('/v1/conversations', { token: businessB.token })).body.conversations;
  assert.equal(afterOther.length, convIdsSince + 1);

  // Web chat produces the same engine output as whatsapp for the same message
  // (one engine, no second WhatsApp brain).
  const touchpoint = (await request('/v1/touchpoints', {
    method: 'POST',
    token: businessB.token,
    body: { name: 'Kappa Landing', type: 'Flyer', agentId: agentBId },
  })).body.touchpoint;
  const webChat = await request(`/v1/t/${touchpoint.trackingId}/messages`, {
    method: 'POST',
    body: { message: 'Hi', customerName: 'Bo', targetLanguage: 'en' },
  });
  assert.equal(webChat.status, 200);
  assert.equal(webChat.body.messages[webChat.body.messages.length - 1].text, 'Mock reply to: Hi');
  assert.equal(webChat.body.channel, 'web');
});

test('13. channel config: public fields only; credential-shaped keys are rejected', async () => {
  const res = await request('/v1/business/channels', { token: businessA.token });
  assert.equal(res.status, 200);
  assert.equal(res.body.channels.length, 0);

  const put = await request('/v1/business/channels/whatsapp', {
    method: 'PUT',
    token: businessA.token,
    body: { enabled: true, displayName: 'WhatsApp Business' },
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.channel.enabled, true);
  assert.equal(put.body.channel.status, 'not_configured');
  assert.equal(put.body.channel.displayName, 'WhatsApp Business');

  const list = await request('/v1/business/channels', { token: businessA.token });
  assert.equal(list.body.channels.length, 1);
  assert.equal(list.body.channels[0].channel, 'whatsapp');
  assert.equal(list.body.channels[0].enabled, true);

  // Credential-shaped keys are never accepted - the public boundary holds.
  for (const key of ['accessToken', 'whatsappApiKey', 'webhookSecret', 'credentials.token']) {
    const bad = await request('/v1/business/channels/whatsapp', {
      method: 'PUT',
      token: businessA.token,
      body: { [key]: 'super-secret' },
    });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.fields && Object.keys(bad.body.fields).length > 0);
  }

  // Unknown channel rejected.
  const bogus = await request('/v1/business/channels/telex', {
    method: 'PUT',
    token: businessA.token,
    body: { enabled: true },
  });
  assert.equal(bogus.status, 400);
});

test('events: commercial events dedupe like Phase 12 (order_created recorded once per order)', async () => {
  const tp = (await request('/v1/touchpoints', {
    method: 'POST',
    token: businessA.token,
    body: { name: 'Iota Dedupe', type: 'Flyer', agentId: agentAId },
  })).body.touchpoint;

  const chat = await request(`/v1/t/${tp.trackingId}/messages`, {
    method: 'POST',
    body: { message: 'I would like a loaf', customerName: 'Zoe', targetLanguage: 'en' },
  });
  const conversationId = chat.body.conversationId;

  const order = (await createOrder(businessA.token, {
    conversationId,
    items: [{ productId: productA.id, quantity: 2 }],
  })).body.order;
  assert.equal(order.total, 17);

  const rows = await funnelRowsFor(conversationId);
  const createdCount = rows.filter((e) => e.event_type === 'order_created' && (e.meta.orderId === order.id)).length;
  assert.equal(createdCount, 1);

  // order items are brightened with an order-scoped dedup key
  await request(`/v1/orders/${order.id}/items`, {
    method: 'POST',
    token: businessA.token,
    body: { items: [{ productId: productC.id, quantity: 1 }] },
  });
  const rowsAfter = await funnelRowsFor(conversationId);
  const itemAddedCount = rowsAfter.filter((e) => e.event_type === 'order_item_added' && (e.meta.orderId === order.id)).length;
  assert.equal(itemAddedCount, 1);
});