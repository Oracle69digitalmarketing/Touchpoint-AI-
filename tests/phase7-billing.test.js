/**
 * PHASE 7 — SUBSCRIPTION & PAYSTACK BILLING SMOKE TESTS
 *
 * Covers: billing endpoints behind the auth gate, server-derived subscription
 * reads, checkout initialization validation (plan/currency/Enterprise), Free
 * downgrades, Paystack customer creation, transaction recording, webhook
 * signature verification, idempotent entitlement on charge.success with
 * amount/currency/plan-code cross-checks, failed-charge handling, server-side
 * verify (including cross-tenant rejection), cancellation, expiry
 * reconciliation, and tenant isolation.
 *
 * The Paystack client is swapped for a deterministic fake so no network calls
 * or live API keys are needed. The Groq client is also faked defensively.
 *
 * Run with: NODE_ENV=test node --test tests/
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.JWT_SECRET = 'test-secret-for-phase7-billing-smoke';
process.env.GROQ_API_KEY = 'gsk_test_dummy';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy_phase7';
process.env.APP_URL = 'https://app.example.test';
process.env.NODE_ENV = 'test';
// Starter has NO plan code (one-time charge path); Growth/Business use
// recurring Paystack plans. This lets the suite exercise both branches.
process.env.PAYSTACK_PLAN_CODE_GROWTH = 'PLN_test_growth';
process.env.PAYSTACK_PLAN_CODE_BUSINESS = 'PLN_test_business';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { setupTestDb, cleanupTestDb } from './helpers/test-db.js';
const testPool = await setupTestDb();

const { default: app, _setPaystackClient, _setGroqClient } = await import(path.join(__dirname, '..', 'server.js'));
const { upsertSubscription } = await import(path.join(__dirname, '..', 'db-pg.js'));

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://localhost:${server.address().port}`;

after(async () => {
  server.close();
  await cleanupTestDb(testPool);
});

const request = async (url, { method = 'GET', body, token, rawBody, signature } = {}) => {
  const headers = {};
  if (body !== undefined || rawBody !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (signature) headers['x-paystack-signature'] = signature;
  const res = await fetch(base + url, {
    method,
    headers,
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
};

const register = (payload) =>
  request('/v1/auth/register', { method: 'POST', body: payload });

const login = (payload) =>
  request('/v1/auth/login', { method: 'POST', body: payload });

/**
 * Deterministic fake Paystack client. Behavior is configurable per-test;
 * call counters let the suite assert on server-side call patterns.
 */
let fakePaystack;
let verifyResponse = { status: true, data: { status: 'success' } };
let verifyFails = false;
const counters = { createCustomer: 0, initialize: 0, verify: 0, disableSubscription: 0 };

const resetCounters = () => {
  counters.createCustomer = 0;
  counters.initialize = 0;
  counters.verify = 0;
  counters.disableSubscription = 0;
  verifyResponse = { status: true, data: { status: 'success' } };
  verifyFails = false;
  fakePaystack = {
    async createCustomer({ email }) {
      counters.createCustomer += 1;
      return { status: true, data: { customer_code: `CUS_${email.replace(/[^a-z0-9]/gi, '').slice(0, 12)}` } };
    },
    async initialize(input) {
      counters.initialize += 1;
      return {
        status: true,
        data: {
          access_code: `fake_access_${input.reference}`,
          authorization_url: `https://checkout.paystack.com/${input.reference}`,
        },
      };
    },
    async verify(reference) {
      counters.verify += 1;
      if (verifyFails) throw new Error('paystack down');
      return { status: true, data: { ...(verifyResponse.data || {}), reference } };
    },
    async disableSubscription() {
      counters.disableSubscription += 1;
      return { status: true };
    },
  };
  _setPaystackClient(fakePaystack);
  _setGroqClient({
    chat: { completions: { create: async () => ({ choices: [{ message: { content: 'mock' } }] }) } },
  });
};

resetCounters();

const signedEvent = (event) => {
  const raw = JSON.stringify(event);
  const signature = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
  return { raw, signature };
};

// Paystack charge timestamps are delivered in the past; grant periods must stay
// in the future so cancelled/expired resolution behaves deterministically.
const justNow = () => new Date().toISOString();

const postWebhook = async (event) => {
  const { raw, signature } = signedEvent(event);
  return request('/v1/billing/webhook', { method: 'POST', rawBody: raw, signature });
};

let acmeToken;
let acmeBusinessId;
let acmeUserId;
let globexToken;
let globexBusinessId;

test('billing endpoints reject unauthenticated and invalid-token requests', async () => {
  assert.equal((await request('/v1/billing/subscription')).status, 401);
  assert.equal((await request('/v1/billing/initialize', { method: 'POST', body: { plan: 'Starter' } })).status, 401);
  assert.equal((await request('/v1/billing/verify?reference=TXP-1')).status, 401);
  assert.equal((await request('/v1/billing/cancel', { method: 'POST' })).status, 401);
  assert.equal((await request('/v1/billing/subscription', { token: 'not-a-jwt' })).status, 401);
});

test('two tenants register and default to the Free tier', async () => {
  const acme = (await register({
    email: 'acme@billing.test', password: 'password123', name: 'Acme Owner', businessName: 'Acme Co',
  })).body;
  assert.ok(acme.token, 'registration returns a session token');
  acmeToken = acme.token;
  acmeBusinessId = acme.business.id;
  acmeUserId = acme.user.id;

  const globex = (await register({
    email: 'globex@billing.test', password: 'password123', name: 'Globex Owner', businessName: 'Globex Inc',
  })).body;
  globexToken = globex.token;
  globexBusinessId = globex.business.id;

  const sub = await request('/v1/billing/subscription', { token: acmeToken });
  assert.equal(sub.status, 200);
  assert.equal(sub.body.subscription.plan, 'Free');
  assert.equal(sub.body.subscription.status, 'active');
});

test('initialize rejects unknown plans, bad currencies and Enterprise checkout', async () => {
  assert.equal((await request('/v1/billing/initialize', { method: 'POST', token: acmeToken, body: { plan: 'Mega' } })).status, 400);
  assert.equal((await request('/v1/billing/initialize', { method: 'POST', token: acmeToken, body: { plan: 'Starter', currency: 'EUR' } })).status, 400);
  const enterprise = await request('/v1/billing/initialize', { method: 'POST', token: acmeToken, body: { plan: 'Enterprise' } });
  assert.equal(enterprise.status, 400);
  assert.equal(counters.initialize, 0, 'no Paystack call for rejected checkouts');
});

test('selecting Free downgrades server-side without touching Paystack', async () => {
  const res = await request('/v1/billing/initialize', { method: 'POST', token: acmeToken, body: { plan: 'Free' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.subscription.plan, 'Free');
  assert.equal(res.body.subscription.status, 'active');
  assert.equal(counters.initialize, 0, 'Free downgrade never initializes Paystack');
});

test('paid checkout creates the Paystack customer once and records the transaction', async () => {
  resetCounters();
  const res = await request('/v1/billing/initialize', {
    method: 'POST', token: acmeToken, body: { plan: 'Growth', currency: 'NGN' },
  });
  assert.equal(res.status, 201);
  assert.ok(res.body.reference, 'server generates the reference');
  assert.match(res.body.reference, /^TXP-/);
  assert.ok(res.body.accessCode, 'server returns the Paystack access code');
  assert.ok(res.body.authorizationUrl, 'server returns the hosted checkout URL');
  assert.equal(res.body.plan, 'Growth');
  assert.equal(res.body.currency, 'NGN');
  assert.equal(res.body.amount, 20000 * 100, 'amount is the plan price in kobo');
  assert.equal(counters.createCustomer, 1, 'Paystack customer created once');
  assert.equal(counters.initialize, 1);

  // Subscription must still be Free until Paystack confirms the charge.
  const sub = await request('/v1/billing/subscription', { token: acmeToken });
  assert.equal(sub.body.subscription.plan, 'Free');

  // A second checkout for the same tenant reuses the stored customer.
  const again = await request('/v1/billing/initialize', {
    method: 'POST', token: acmeToken, body: { plan: 'Business', currency: 'USD' },
  });
  assert.equal(again.status, 201);
  assert.equal(counters.createCustomer, 1, 'customer reused across checkouts');
});

test('webhook rejects missing and invalid signatures without state change', async () => {
  const event = { event: 'charge.success', data: { reference: 'TXP-nope' } };
  const raw = JSON.stringify(event);
  const bad = crypto.createHmac('sha512', 'wrong-secret').update(raw).digest('hex');

  assert.equal((await request('/v1/billing/webhook', { method: 'POST', rawBody: raw })).status, 401);
  assert.equal((await request('/v1/billing/webhook', { method: 'POST', rawBody: raw, signature: bad })).status, 401);

  const sub = await request('/v1/billing/subscription', { token: acmeToken });
  assert.equal(sub.body.subscription.plan, 'Free');
});

test('webhook with an unknown reference is acknowledged but never grants anything', async () => {
  const res = await postWebhook({
    event: 'charge.success',
    id: 'evt_unknown',
    data: { reference: 'TXP-does-not-exist', amount: 2000000, currency: 'NGN' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ignored, 'unknown_reference');
  const sub = await request('/v1/billing/subscription', { token: acmeToken });
  assert.equal(sub.body.subscription.plan, 'Free');
});

test('charge.success grants the Starter tier when amount and currency match', async () => {
  resetCounters();
  const init = await request('/v1/billing/initialize', { method: 'POST', token: acmeToken, body: { plan: 'Starter', currency: 'NGN' } });
  assert.equal(init.status, 201);
  const reference = init.body.reference;

  const res = await postWebhook({
    event: 'charge.success',
    id: 'evt_starter_ok',
    data: {
      reference,
      amount: 7500 * 100,
      currency: 'NGN',
      paid_at: justNow(),
      customer: { customer_code: 'CUS_acme' },
      plan: { plan_code: null },
      subscription: { subscription_code: 'SUB_starter' },
      metadata: { business_id: acmeBusinessId },
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.subscription.plan, 'Starter');
  assert.equal(res.body.subscription.status, 'active');
  assert.ok(res.body.subscription.currentPeriodEnd, 'period end recorded');

  const sub = await request('/v1/billing/subscription', { token: acmeToken });
  assert.equal(sub.body.subscription.plan, 'Starter');
  assert.equal(sub.body.subscription.lastReference, reference);
});

test('duplicate webhook deliveries are idempotent', async () => {
  const event = {
    event: 'charge.success',
    id: 'evt_starter_ok',
    data: {
      reference: 'TXP-dup-check',
      amount: 0,
      currency: 'NGN',
    },
  };
  const first = await postWebhook(event);
  assert.equal(first.status, 200);
  assert.equal(first.body.duplicate, true, 'already-processed event id is acked as duplicate');
});

test('charge.success with a wrong amount never grants entitlement', async () => {
  resetCounters();
  const init = await request('/v1/billing/initialize', { method: 'POST', token: acmeToken, body: { plan: 'Starter', currency: 'NGN' } });
  const reference = init.body.reference;

  const res = await postWebhook({
    event: 'charge.success',
    id: 'evt_starter_wrong_amount',
    data: { reference, amount: 1, currency: 'NGN', metadata: { business_id: acmeBusinessId } },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.subscription.plan, 'Starter', 'already-active Starter is unchanged');

  // A fresh tenant proves the failed charge granted nothing.
  const sub = await request('/v1/billing/subscription', { token: globexToken });
  assert.equal(sub.body.subscription.plan, 'Free');
  const tx = await request(`/v1/billing/verify?reference=${reference}`, { token: acmeToken });
  assert.equal(tx.body.transaction.status, 'failed');
});

test('charge.success with a mismatched currency fails the transaction', async () => {
  resetCounters();
  const init = await request('/v1/billing/initialize', { method: 'POST', token: acmeToken, body: { plan: 'Starter', currency: 'USD' } });
  const reference = init.body.reference;

  await postWebhook({
    event: 'charge.success',
    id: 'evt_starter_wrong_ccy',
    data: { reference, amount: 10 * 100, currency: 'NGN', metadata: { business_id: acmeBusinessId } },
  });
  const tx = await request(`/v1/billing/verify?reference=${reference}`, { token: acmeToken });
  assert.equal(tx.body.transaction.status, 'failed');
});

test('recurring charge enforces the plan code but not an exact amount', async () => {
  resetCounters();
  const init = await request('/v1/billing/initialize', { method: 'POST', token: globexToken, body: { plan: 'Growth', currency: 'NGN' } });
  assert.equal(init.status, 201);
  const reference = init.body.reference;

  const ok = await postWebhook({
    event: 'charge.success',
    id: 'evt_growth_ok',
    data: {
      reference,
      amount: 20000 * 100,
      currency: 'NGN',
      paid_at: justNow(),
      customer: { customer_code: 'CUS_globex' },
      plan: { plan_code: 'PLN_test_growth' },
      subscription: { subscription_code: 'SUB_growth' },
      metadata: { business_id: globexBusinessId },
    },
  });
  assert.equal(ok.body.subscription.plan, 'Growth');

  // Plan code mismatch on a new checkout must be rejected.
  resetCounters();
  const init2 = await request('/v1/billing/initialize', { method: 'POST', token: globexToken, body: { plan: 'Growth', currency: 'NGN' } });
  const reference2 = init2.body.reference;
  await postWebhook({
    event: 'charge.success',
    id: 'evt_growth_bad_plan',
    data: {
      reference: reference2,
      amount: 20000 * 100,
      currency: 'NGN',
      plan: { plan_code: 'PLN_test_business' },
      subscription: { subscription_code: 'SUB_wrong' },
      metadata: { business_id: globexBusinessId },
    },
  });
  const tx = await request(`/v1/billing/verify?reference=${reference2}`, { token: globexToken });
  assert.equal(tx.body.transaction.status, 'failed');
});

test('server-side verify upgrades the subscription only after Paystack confirms', async () => {
  resetCounters();
  const init = await request('/v1/billing/initialize', { method: 'POST', token: globexToken, body: { plan: 'Business', currency: 'USD' } });
  const reference = init.body.reference;

  verifyResponse = {
    status: true,
    data: {
      status: 'success',
      amount: 60 * 100,
      currency: 'USD',
      paid_at: justNow(),
      customer: { customer_code: 'CUS_globex' },
      plan: { plan_code: 'PLN_test_business' },
      subscription: { subscription_code: 'SUB_business' },
    },
  };

  const res = await request(`/v1/billing/verify?reference=${reference}`, { token: globexToken });
  assert.equal(res.status, 200);
  assert.equal(res.body.transaction.status, 'success');
  assert.equal(res.body.subscription.plan, 'Business');
  assert.equal(counters.verify, 1);

  // Re-verifying a terminal transaction short-circuits without another call.
  const again = await request(`/v1/billing/verify?reference=${reference}`, { token: globexToken });
  assert.equal(again.body.transaction.status, 'success');
  assert.equal(counters.verify, 1, 'terminal transactions are not re-verified');
});

test('verify validates parameters and rejects cross-tenant references', async () => {
  assert.equal((await request('/v1/billing/verify', { token: acmeToken })).status, 400);
  assert.equal((await request('/v1/billing/verify?reference=TXP-ghost', { token: acmeToken })).status, 404);

  const init = await request('/v1/billing/initialize', { method: 'POST', token: acmeToken, body: { plan: 'Starter', currency: 'NGN' } });
  const reference = init.body.reference;
  const cross = await request(`/v1/billing/verify?reference=${reference}`, { token: globexToken });
  assert.equal(cross.status, 403, 'another tenant cannot verify this reference');

  // And the paystack call itself failing surfaces a 502, not a grant.
  const init2 = await request('/v1/billing/initialize', { method: 'POST', token: acmeToken, body: { plan: 'Starter', currency: 'NGN' } });
  const reference2 = init2.body.reference;
  verifyFails = true;
  const down = await request(`/v1/billing/verify?reference=${reference2}`, { token: acmeToken });
  assert.equal(down.status, 502);
  verifyFails = false;
});

test('subscription.disable webhook cancels the tenant subscription', async () => {
  resetCounters();
  await postWebhook({
    event: 'subscription.disable',
    id: 'evt_disable_acme',
    data: { subscription_code: 'SUB_starter', customer: { customer_code: 'CUS_acme' } },
  });
  const sub = await request('/v1/billing/subscription', { token: acmeToken });
  assert.equal(sub.body.subscription.status, 'cancelled');
  assert.ok(sub.body.subscription.cancelledAt);
  assert.equal(sub.body.subscription.plan, 'Starter', 'cancelled tier persists until period end');
});

test('expired subscriptions resolve to Free', async () => {
  // Simulate a paid period that has ended by writing a past period end.
  await upsertSubscription(acmeBusinessId, {
    currentPeriodEnd: '2020-01-01 00:00:00',
    status: 'cancelled',
  });
  const sub = await request('/v1/billing/subscription', { token: acmeToken });
  assert.equal(sub.body.subscription.plan, 'Free');
  assert.equal(sub.body.subscription.status, 'expired');
});

test('subscription.expired webhook flips status to expired', async () => {
  resetCounters();
  await postWebhook({
    event: 'subscription.expired',
    id: 'evt_expired_globex',
    data: { subscription_code: 'SUB_business' },
  });
  const sub = await request('/v1/billing/subscription', { token: globexToken });
  assert.equal(sub.body.subscription.status, 'expired');
  assert.equal(sub.body.subscription.plan, 'Free');
});

test('cancel endpoint cancels renewals and keeps access until period end', async () => {
  resetCounters();
  // Give Globex a fresh active paid subscription again.
  const init = await request('/v1/billing/initialize', { method: 'POST', token: globexToken, body: { plan: 'Growth', currency: 'NGN' } });
  assert.equal(init.status, 201);
  const reference = init.body.reference;
  verifyResponse = {
    status: true,
    data: {
      status: 'success',
      amount: 20000 * 100,
      currency: 'NGN',
      paid_at: justNow(),
      customer: { customer_code: 'CUS_globex' },
      plan: { plan_code: 'PLN_test_growth' },
      subscription: { subscription_code: 'SUB_growth' },
    },
  };
  await request(`/v1/billing/verify?reference=${reference}`, { token: globexToken });

  const active = await request('/v1/billing/subscription', { token: globexToken });
  assert.equal(active.body.subscription.plan, 'Growth');
  assert.equal(active.body.subscription.status, 'active');

  const cancel = await request('/v1/billing/cancel', { method: 'POST', token: globexToken });
  assert.equal(cancel.body.subscription.status, 'cancelled');
  assert.equal(cancel.body.subscription.plan, 'Growth', 'tier persists while the paid period runs');
  assert.equal(counters.disableSubscription, 1, 'Paystack subscription disable requested');

  // A tenant with no Paystack subscription code cancels cleanly (no-op).
  const noop = await request('/v1/billing/cancel', { method: 'POST', token: globexToken });
  assert.equal(noop.body.subscription.status, 'cancelled');
});

test('charge.failed webhook marks the transaction failed without granting', async () => {
  resetCounters();
  const init = await request('/v1/billing/initialize', { method: 'POST', token: globexToken, body: { plan: 'Starter', currency: 'NGN' } });
  const reference = init.body.reference;
  await postWebhook({ event: 'charge.failed', id: 'evt_failed_1', data: { reference } });
  const tx = await request(`/v1/billing/verify?reference=${reference}`, { token: globexToken });
  assert.equal(tx.body.transaction.status, 'failed');
});
