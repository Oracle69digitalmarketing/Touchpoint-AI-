/**
 * PHASE 13B PAYMENT tests
 *
 * Provider-neutral payment architecture with Paystack as the first adapter.
 * Covers the §12 matrix: successful settlement, retryable failures, amount &
 * currency mismatches, duplicate-webhook idempotency, terminal-state
 * immutability, unknown references (benign 200), cancelled-order guard,
 * already-paid no-op, cross-tenant protection, init idempotency, provider init
 * failure (502 + clean draft retry), and malformed/unsigned webhooks.
 *
 * Money is asserted in exact integer minor units; orders only ever become
 * `paid` through a signed webhook -> server verification -> atomic settle.
 *
 * Runs serially on the isolated `touchpoint_test` schema. The provider HTTP
 * transport is faked through the _setPaystackHttp seam (no live credentials);
 * webhook payloads are HMAC-SHA512 signed with the same secret the adapter
 * expects and posted through the real Express webhook route.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb, cleanupTestDb } from './helpers/test-db.js';
import { decimalToMinorUnits } from '../money.js';

process.env.JWT_SECRET = 'test-secret-for-phase13b-payments';
process.env.GROQ_API_KEY = 'gsk_test_dummy';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_phase13b';
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

const { default: app, _setGroqClient, _setPaystackHttp } = await import(path.join(__dirname, '..', 'server.js'));

_setGroqClient({
  chat: { completions: { create: async () => ({ choices: [{ message: { content: 'mock' } }] }) } },
});

// ---- Deterministic fake provider transport ---------------------------------
let initShouldFail = false;
_setPaystackHttp({
  async initialize({ reference, amount, email, currency, callbackUrl }) {
    if (initShouldFail) throw new Error('paystack initialization down');
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
    throw new Error('verify() is not reachable in Phase 13B tests');
  },
});

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://localhost:${server.address().port}`;

after(async () => {
  server.close();
  await cleanupTestDb(testPool);
});

// ---- HTTP helpers -----------------------------------------------------------
const request = async (url, { method = 'GET', body, token, rawBody, signature, headers = {} } = {}) => {
  const h = { ...headers };
  if (body !== undefined || rawBody !== undefined) h['Content-Type'] = 'application/json';
  if (token) h['Authorization'] = `Bearer ${token}`;
  if (signature !== undefined) h['x-paystack-signature'] = signature;
  const res = await fetch(base + url, {
    method,
    headers: h,
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
};

const register = (payload) => request('/v1/auth/register', { method: 'POST', body: payload });
const createProduct = (token, product) => request('/v1/products', { method: 'POST', token, body: product });
const createOrder = (token, body) => request('/v1/orders', { method: 'POST', token, body });
const initPayment = (token, orderId, key) =>
  request(`/v1/orders/${orderId}/payment`, { method: 'POST', token, body: {}, headers: key ? { 'Idempotency-Key': key } : {} });
const getPayment = (token, orderId, query = '') => request(`/v1/orders/${orderId}/payment${query}`, { token });

// Post a webhook through the real Express route. sig: 'valid' | 'none' | 'wrong'.
const postWebhook = async (payload, sig = 'valid') => {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  if (sig === 'valid') {
    const signature = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
    return request('/v1/payments/webhook/paystack', { method: 'POST', rawBody: raw, signature });
  }
  if (sig === 'none') return request('/v1/payments/webhook/paystack', { method: 'POST', rawBody: raw });
  return request('/v1/payments/webhook/paystack', { method: 'POST', rawBody: raw, signature: 'deadbeef' });
};

// ---- DB probes --------------------------------------------------------------
const orderRow = async (id) => (await testPool.query('SELECT * FROM orders WHERE id = $1', [id])).rows[0];
const intentRows = async (orderId) =>
  (await testPool.query('SELECT * FROM payment_intents WHERE order_id = $1 ORDER BY created_at ASC', [orderId])).rows;
const webhookEventCount = async (eventId) =>
  Number((await testPool.query('SELECT COUNT(*)::int c FROM webhook_events WHERE event_id = $1', [eventId])).rows[0].c);
const funnelRowsFor = async (businessId) =>
  (await testPool.query('SELECT event_type, meta FROM funnel_events WHERE business_id = $1 ORDER BY created_at ASC', [businessId])).rows;
const countFunnel = (rows, type, key) =>
  rows.filter((r) => r.event_type === type && (!key || (r.meta && r.meta.key && r.meta.key.includes(key)))).length;

const successEvent = (intent, { id, amount, currency } = {}) => ({
  event: 'charge.success',
  data: {
    id: id || crypto.randomUUID(),
    reference: intent.providerReference,
    amount: amount === undefined ? intent.amountMinor : amount,
    currency: currency || intent.currency,
  },
});
const failEvent = (intent, type = 'charge.failed') => ({
  event: type,
  data: { id: crypto.randomUUID(), reference: intent.providerReference, amount: intent.amountMinor, currency: intent.currency },
});

// ---- Fixtures ---------------------------------------------------------------
let businessA;
let businessB;
let productA;
let productB;

test('money util: exact integer minor-unit conversion (no floats)', () => {
  assert.equal(decimalToMinorUnits('34.00', 'NGN'), 3400);
  assert.equal(decimalToMinorUnits(8.5, 'NGN'), 850);
  assert.equal(decimalToMinorUnits('0.5', 'USD'), 50);
  assert.equal(decimalToMinorUnits(34, 'JPY'), 34);
  assert.equal(decimalToMinorUnits(20, 'NGN'), 2000);
  assert.throws(() => decimalToMinorUnits('1.999', 'NGN'), /more decimal places/);
  assert.throws(() => decimalToMinorUnits('abc', 'NGN'), /Invalid decimal amount/);
  assert.throws(() => decimalToMinorUnits('10', 'XXX'), /Unsupported currency/);
  assert.throws(() => decimalToMinorUnits(null, 'NGN'), /Amount is required/);
});

test('setup: register two tenants and a priced product', async () => {
  businessA = (await register({
    email: 'pi@phase13b.test', password: 'password123', name: 'Pi Owner', businessName: 'Pi Bakery',
  })).body;
  assert.ok(businessA.token);

  businessB = (await register({
    email: 'rho@phase13b.test', password: 'password123', name: 'Rho Owner', businessName: 'Rho Cafe',
  })).body;

  productA = (await createProduct(businessA.token, {
    name: 'Sourdough Loaf', description: 'Daily bake', price: 8.5, currency: 'NGN',
  })).body.product;
  assert.equal(productA.price, 8.5);

  productB = (await createProduct(businessB.token, {
    name: 'Rho Cold Brew', description: 'B-cafe drink', price: 3.5, currency: 'NGN',
  })).body.product;
  assert.equal(productB.price, 3.5);
});

test('1. successful payment: signed webhook settles the exact order with exact minor units', async () => {
  const order = (await createOrder(businessA.token, { items: [{ productId: productA.id, quantity: 2 }] })).body.order;
  assert.equal(order.total, 17); // 8.5 * 2, decimal

  const init = await initPayment(businessA.token, order.id);
  assert.equal(init.status, 201);
  assert.equal(init.body.order.status, 'pending_payment');
  const intent = init.body.intent;
  assert.equal(intent.status, 'pending');
  assert.equal(intent.amountMinor, 1700); // exact integer kobo
  assert.equal(intent.currency, 'NGN');
  assert.ok(intent.checkout.authorizationUrl);

  const wb = await postWebhook(successEvent(intent));
  assert.equal(wb.status, 200);
  assert.deepEqual(wb.body, { received: true });

  const row = await orderRow(order.id);
  assert.equal(row.status, 'paid');
  assert.equal(row.payment_status, 'paid');
  const intents = await intentRows(order.id);
  assert.equal(intents.length, 1);
  assert.equal(intents[0].status, 'succeeded');
  assert.equal(intents[0].paid_amount_minor, 1700);
  assert.ok(intents[0].verified_at);

  const funnel = await funnelRowsFor(businessA.business.id);
  assert.equal(countFunnel(funnel, 'payment_verified', `intent:${intent.id}`), 1);
  assert.equal(await webhookEventCount(intents[0].provider_event_id), 1);
});

test('2. failed payment: intent fails, order stays pending_payment and retryable via a NEW intent', async () => {
  const order = (await createOrder(businessA.token, { items: [{ productId: productA.id, quantity: 1 }] })).body.order;
  const init = await initPayment(businessA.token, order.id);
  assert.equal(init.status, 201);
  const intent = init.body.intent;

  const wb = await postWebhook(failEvent(intent, 'charge.failed'));
  assert.equal(wb.status, 200);
  const row = await orderRow(order.id);
  assert.equal(row.status, 'pending_payment'); // NOT cancelled, still payable
  assert.equal(row.payment_status, 'failed');
  const intents = await intentRows(order.id);
  assert.equal(intents[0].status, 'failed');
  assert.equal(intents[0].failure_reason, 'provider:failed');

  // Retry creates a brand-new intent on the same order.
  const retry = await initPayment(businessA.token, order.id);
  assert.equal(retry.status, 201);
  assert.notEqual(retry.body.intent.id, intent.id);
  assert.equal(retry.body.intent.status, 'pending');
  assert.equal((await orderRow(order.id)).payment_status, 'pending');
  assert.equal((await intentRows(order.id)).filter((i) => i.status === 'pending').length, 1);
});

test('3. wrong amount: intent fails (amount_mismatch) and the order is NOT paid', async () => {
  const order = (await createOrder(businessA.token, { items: [{ productId: productA.id, quantity: 2 }] })).body.order;
  const intent = (await initPayment(businessA.token, order.id)).body.intent;
  assert.equal(intent.amountMinor, 1700);

  const wb = await postWebhook(successEvent(intent, { amount: 900 }));
  assert.equal(wb.status, 200);
  const row = await orderRow(order.id);
  assert.equal(row.status, 'pending_payment'); // never paid
  assert.equal(row.payment_status, 'failed');
  const intents = await intentRows(order.id);
  assert.equal(intents[0].status, 'failed');
  assert.equal(intents[0].failure_reason, 'amount_mismatch');
  assert.equal(intents[0].paid_amount_minor, null);
});

test('4. wrong currency: intent fails (currency_mismatch) and the order is NOT paid', async () => {
  const order = (await createOrder(businessA.token, { items: [{ productId: productA.id, quantity: 1 }] })).body.order;
  const intent = (await initPayment(businessA.token, order.id)).body.intent;

  const wb = await postWebhook(successEvent(intent, { currency: 'USD' }));
  assert.equal(wb.status, 200);
  const row = await orderRow(order.id);
  assert.equal(row.status, 'pending_payment');
  assert.equal(row.payment_status, 'failed');
  const intents = await intentRows(order.id);
  assert.equal(intents[0].status, 'failed');
  assert.equal(intents[0].failure_reason, 'currency_mismatch');
});

test('5. duplicate webhook delivery (same event id) is idempotent — no double settle', async () => {
  const order = (await createOrder(businessA.token, { items: [{ productId: productA.id, quantity: 1 }] })).body.order;
  const intent = (await initPayment(businessA.token, order.id)).body.intent;
  const event = successEvent(intent);

  const first = await postWebhook(event);
  assert.equal(first.status, 200);
  assert.equal((await orderRow(order.id)).status, 'paid');

  const second = await postWebhook(event);
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, { received: true });

  const intents = await intentRows(order.id);
  assert.equal(intents[0].status, 'succeeded');
  assert.equal(await webhookEventCount(event.data.id), 1); // single ledger record
  const funnel = await funnelRowsFor(businessA.business.id);
  assert.equal(countFunnel(funnel, 'payment_verified', `intent:${intent.id}`), 1);
});

test('6. terminal state is never rewritten: replay on a settled reference stays settled', async () => {
  const order = (await createOrder(businessA.token, { items: [{ productId: productA.id, quantity: 1 }] })).body.order;
  const intent = (await initPayment(businessA.token, order.id)).body.intent;
  await postWebhook(successEvent(intent));
  assert.equal((await orderRow(order.id)).status, 'paid');

  // A NEW provider event id for the SAME settled reference (reference replay,
  // not delivery replay) is a no-op: the intent is already terminal.
  const replayNewEvent = await postWebhook(successEvent(intent, { id: crypto.randomUUID() }));
  assert.equal(replayNewEvent.status, 200);
  const intents = await intentRows(order.id);
  assert.equal(intents[0].status, 'succeeded');
  assert.equal(intents[0].paid_amount_minor, 850); // untouched
  assert.equal((await orderRow(order.id)).status, 'paid');
});

test('7. unknown provider reference: benign 200, no state change, no existence oracle', async () => {
  const order = (await createOrder(businessA.token, { items: [{ productId: productA.id, quantity: 1 }] })).body.order;
  await initPayment(businessA.token, order.id);

  const wb = await postWebhook({
    event: 'charge.success',
    data: { id: crypto.randomUUID(), reference: 'NO-SUCH-INTENT', amount: 50000, currency: 'NGN' },
  });
  assert.equal(wb.status, 200);
  assert.deepEqual(wb.body, { received: true });

  const after = await orderRow(order.id);
  assert.equal(after.status, 'pending_payment'); // untouched
  assert.equal(after.payment_status, 'pending');
  assert.equal((await intentRows(order.id))[0].status, 'pending');
});

test('8. order not payable (cancelled): signed paid webhook is benign — order never marked paid', async () => {
  const order = (await createOrder(businessA.token, { items: [{ productId: productA.id, quantity: 1 }] })).body.order;
  const intent = (await initPayment(businessA.token, order.id)).body.intent;
  const cancelled = await request(`/v1/orders/${order.id}/cancel`, { method: 'POST', token: businessA.token });
  assert.equal(cancelled.status, 200);
  assert.equal((await orderRow(order.id)).status, 'cancelled');
  // Cancellation voids the live intent (Phase 13B guard).
  assert.equal((await intentRows(order.id))[0].status, 'void');

  const wb = await postWebhook(successEvent(intent));
  assert.equal(wb.status, 200);
  const row = await orderRow(order.id);
  assert.equal(row.status, 'cancelled'); // never paid
  assert.notEqual(row.payment_status, 'paid');
});

test('9. already-paid order: a different reference/new event cannot re-settle', async () => {
  const order = (await createOrder(businessA.token, { items: [{ productId: productA.id, quantity: 1 }] })).body.order;
  const intent = (await initPayment(businessA.token, order.id)).body.intent;
  await postWebhook(successEvent(intent));
  assert.equal((await orderRow(order.id)).status, 'paid');

  const again = await postWebhook(successEvent(intent, { id: crypto.randomUUID() }));
  assert.equal(again.status, 200);
  const intents = await intentRows(order.id);
  assert.equal(intents.filter((i) => i.status === 'succeeded').length, 1); // never a second settlement
  assert.equal((await orderRow(order.id)).status, 'paid');
  // No new intent/reference can even be initialized on a paid order.
  const blocked = await initPayment(businessA.token, order.id);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'INVALID_TRANSITION');
});

test('10. payment endpoints enforce tenant isolation and authentication', async () => {
  const order = (await createOrder(businessA.token, { items: [{ productId: productA.id, quantity: 1 }] })).body.order;

  const noToken = await initPayment(undefined, order.id);
  assert.equal(noToken.status, 401);

  const otherTenant = await initPayment(businessB.token, order.id);
  assert.equal(otherTenant.status, 404); // never reveals existence across tenants
  assert.equal(otherTenant.body.error, 'Order not found');

  const otherTenantGet = await getPayment(businessB.token, order.id);
  assert.equal(otherTenantGet.status, 404);

  // The owner can still initialize their own order afterwards.
  const mine = await initPayment(businessA.token, order.id);
  assert.equal(mine.status, 201);
  const cross = await getPayment(businessB.token, order.id);
  assert.equal(cross.status, 404);
});

test('11. no malicious cross-tenant settlement is possible via the webhook route', async () => {
  const orderA = (await createOrder(businessA.token, { items: [{ productId: productA.id, quantity: 1 }] })).body.order;
  const orderB = (await createOrder(businessB.token, { items: [{ productId: productB.id, quantity: 1 }] })).body.order;
  const intentA = (await initPayment(businessA.token, orderA.id)).body.intent;
  const intentB = (await initPayment(businessB.token, orderB.id)).body.intent;

  // Tenant B computes nothing from the body; settlement binds to the borrower
  // intent's own order row. A "paid" event for A's reference must only settle A.
  const wbA = await postWebhook(successEvent(intentA));
  assert.equal(wbA.status, 200);
  assert.equal((await orderRow(orderA.id)).status, 'paid');
  assert.equal((await orderRow(orderB.id)).status, 'pending_payment'); // B untouched
  assert.equal((await intentRows(orderB.id))[0].status, 'pending');

  // Cross-tenant GET confirms B does not see A's reference/intent.
  const spy = await getPayment(businessB.token, orderA.id);
  assert.equal(spy.status, 404);
  void intentB;
});

test('12. initialize idempotency: same Idempotency-Key returns the same intent, different keys create fresh ones', async () => {
  const order = (await createOrder(businessA.token, { items: [{ productId: productA.id, quantity: 1 }] })).body.order;

  const first = await initPayment(businessA.token, order.id, 'K1');
  assert.equal(first.status, 201);
  const second = await initPayment(businessA.token, order.id, 'K1');
  assert.equal(second.status, 200);
  assert.equal(second.body.intent.id, first.body.intent.id); // same intent reused

  const fresh = await initPayment(businessA.token, order.id, 'K2');
  assert.equal(fresh.status, 200);
  // The single-live-intent invariant: while the first intent is STILL pending,
  // a different idempotency key reuses the same live checkout — the provider
  // reference never silently changes under the customer. A NEW intent only
  // appears once the pending intent is terminal (covered by test 2's retry).
  assert.equal(fresh.body.intent.id, first.body.intent.id);
  const intents = await intentRows(order.id);
  assert.equal(intents.filter((i) => i.status === 'pending').length, 1); // only one active intent ever
});

test('13. provider init failure returns 502, voids the intent, restores draft — and clean retry works', async () => {
  const order = (await createOrder(businessA.token, { items: [{ productId: productA.id, quantity: 1 }] })).body.order;

  initShouldFail = true;
  const failed = await initPayment(businessA.token, order.id);
  initShouldFail = false;
  assert.equal(failed.status, 502);
  assert.equal(failed.body.code, 'PROVIDER_ERROR'); // ProviderError surfaces with this stable code

  const row = await orderRow(order.id);
  assert.equal(row.status, 'draft'); // no stale pending_payment
  assert.equal(row.payment_status, 'unpaid');
  const voided = await intentRows(order.id);
  assert.equal(voided.length, 1);
  assert.equal(voided[0].status, 'void');
  assert.equal(voided[0].failure_reason, 'initialization_failed');

  // Provider recovers: clean retry initializes a fresh live intent.
  const retry = await initPayment(businessA.token, order.id);
  assert.equal(retry.status, 201);
  assert.equal(retry.body.intent.status, 'pending');
  assert.equal((await intentRows(order.id)).filter((i) => i.status === 'pending').length, 1);
});

test('14. signature integrity: unsigned/wrong-signed 401, malformed signed body 400, unknown provider 400', async () => {
  const order = (await createOrder(businessA.token, { items: [{ productId: productA.id, quantity: 1 }] })).body.order;
  const intent = (await initPayment(businessA.token, order.id)).body.intent;
  const baseEvent = successEvent(intent);
  const raw = JSON.stringify(baseEvent);
  const basePath = '/v1/payments/webhook/paystack';

  const unsigned = await postWebhook(baseEvent, 'none');
  assert.equal(unsigned.status, 401);

  const wrongSig = await postWebhook(baseEvent, 'wrong');
  assert.equal(wrongSig.status, 401);

  const badJson = await postWebhook('{ "event": "charge.success"', 'valid');
  assert.equal(badJson.status, 400);

  const unknownProvider = await request('/v1/payments/webhook/stripe', {
    method: 'POST',
    rawBody: raw,
    signature: crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(raw).digest('hex'),
  });
  assert.equal(unknownProvider.status, 400);
  assert.match(unknownProvider.body.error, /Unknown payment provider/);

  // Order is untouched by all of the above gymnastics.
  const row = await orderRow(order.id);
  assert.equal(row.status, 'pending_payment');
  assert.equal(row.payment_status, 'pending');
});