/**
 * PHASE 13C BOOKING tests
 *
 * Deterministic, server-authoritative scheduling surface:
 *
 *   - pure unit core: exact-slot grid math (duration + buffer), DST-safe IANA
 *     timezone slot generation, signed slot tokens (tamper-evident), config
 *     normalization and the closed status lifecycle;
 *   - config management: validation rejection + config_version bumps;
 *   - availability: operating hours, buffers, blackout dates, advance bounds,
 *     capacity/occupancy reflection and 24/7 grids;
 *   - reservation: advisory-lock no-overbook, idempotency, concurrency,
 *     capacity N vs N+1;
 *   - lifecycle: reserved -> confirmed -> completed / no-show, cancellation,
 *     atomic reschedule (with concurrency + disabled), hold expiry;
 *   - boundaries: stale slot tokens, tenant isolation, public vs authenticated
 *     surfaces, inactive touchpoints;
 *   - commercial actions: the BOOK executor books the exact server-issued slot
 *     and never a date the AI invented;
 *   - AI hallucination prevention: the system prompt contains the BOOKING RULES
 *     block and only server-computed options; no request body ever sets status;
 *   - payment separation: a requires_payment product stays `reserved` until a
 *     management confirm, and a booking never touches orders/payment_intents.
 *
 * Runs serially on the isolated `touchpoint_test` schema. The Groq client (and
 * Paystack transport) are swapped for deterministic fakes via seams, so no live
 * credentials are needed and no remote calls are made.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb, cleanupTestDb } from './helpers/test-db.js';
import {
  issueSlotToken,
  parseSlotToken,
  normalizeBookingConfig,
  canTransition,
  BOOKING_STATUSES,
} from '../booking-provider.js';
import { availableSlots, isExactSlot, BOOKING_CONSTRAINTS } from '../booking-time.js';

process.env.JWT_SECRET = 'test-secret-for-phase13c-booking';
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

const { default: app, _setGroqClient, _setPaystackHttp } = await import(path.join(__dirname, '..', 'server.js'));

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
    throw new Error('verify is not used by the Phase 13C suite');
  },
});

let lastSystemPrompt = null;
_setGroqClient({
  chat: {
    completions: {
      create: async ({ messages }) => {
        const system = (messages.find((m) => m.role === 'system') || {}).content || '';
        if (system.includes('lead qualification engine')) {
          return { choices: [{ message: { content: JSON.stringify({ name: null, phone: null, email: null, intent: null, qualificationScore: 0 }) } }] };
        }
        lastSystemPrompt = system;
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
  server.close();
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
const createProduct = (token, product) => request('/v1/products', { method: 'POST', token, body: product });
const createAgent = (token, name) =>
  request('/v1/agents', { method: 'POST', token, body: { name, industry: 'Services', voice: 'professional', description: 'Booking specialist' } });
const createTouchpoint = (token, { name, agentId }) =>
  request('/v1/touchpoints', { method: 'POST', token, body: { name, type: 'Flyer', agentId } });
const updateTouchpoint = (token, id, body) => request(`/v1/touchpoints/${id}`, { method: 'PUT', token, body });
const putConfig = (token, productId, cfg) => request(`/v1/products/${productId}/booking-config`, { method: 'PUT', token, body: cfg });
const deleteConfig = (token, productId) => request(`/v1/products/${productId}/booking-config`, { method: 'DELETE', token });
const getConfigs = (token) => request('/v1/booking/configs', { token });
const listProducts = (token, query = '') => request(`/v1/products${query}`, { token });
const available = (trackingId, params = {}) =>
  request(`/v1/t/${trackingId}/booking/available?${new URLSearchParams(params).toString()}`, {});
const reserve = (trackingId, body) => request(`/v1/t/${trackingId}/booking/reserve`, { method: 'POST', body });
const listBookings = (token, query = '') => request(`/v1/bookings${query}`, { token });
const getBooking = (token, id) => request(`/v1/bookings/${id}`, { token });
const bookingAction = (token, id, action, body = {}) => request(`/v1/bookings/${id}/${action}`, { method: 'POST', token, body });
const expireStale = (token) => request('/v1/bookings/expire-stale', { method: 'POST', token });
const proposeAction = (token, body) => request('/v1/commercial/actions/propose', { method: 'POST', token, body });
const executeAction = (token, id) => request(`/v1/commercial/actions/${id}/execute`, { method: 'POST', token });
const sandboxChat = (token, body) => request('/v1/ai/chat', { method: 'POST', token, body });

// ---- DB probes --------------------------------------------------------------
const clearBookings = async (productId) => {
  await testPool.query('DELETE FROM bookings WHERE product_id = $1', [productId]);
};
const bookingRow = async (id) => (await testPool.query('SELECT * FROM bookings WHERE id = $1', [id])).rows[0];
const forceHoldExpired = async (id) => {
  await testPool.query(`UPDATE bookings SET hold_until = now() - interval '1 minute' WHERE id = $1`, [id]);
};
const funnelRowsFor = async (businessId) => {
  const res = await testPool.query('SELECT event_type, meta FROM funnel_events WHERE business_id = $1', [businessId]);
  return res.rows.map((r) => ({ event_type: r.event_type, meta: r.meta || {} }));
};
const countFunnel = (rows, type, key) =>
  rows.filter((r) => r.event_type === type && (!key || (r.meta && r.meta.key && r.meta.key.includes(key)))).length;
const countTable = async (table, businessId) =>
  Number((await testPool.query(`SELECT COUNT(*)::int c FROM ${table} WHERE business_id = $1`, [businessId])).rows[0].c);
const slotMinutes = (slot) => Math.round((new Date(slot.endUtc).getTime() - new Date(slot.startUtc).getTime()) / 60000);

// ---- Fixtures ---------------------------------------------------------------
let businessA;
let businessB;
let agentAId;
let agentBId;
let tpA;      // active customer touchpoint for business A
let tpB;      // active customer touchpoint for business B
let prodConsult; // A: 24/7  60min cap1 auto-confirm (main surface)
let prodNy;      // A: America/New_York 09:00-17:00 (DST + grid)
let prodWed;     // A: Wed-only 30min + 15 buffer + blackout (grid + buffer)
let prodGroup;   // A: capacity 2 24/7 (capacity N/N+1 + reschedule-full)
let prodFlex;    // A: auto_confirm false hold 15 (lifecycle + expiry)
let prodCross;   // B: cross-tenant product (tenant isolation)

// ---- Pure unit core (no network, no DB) -------------------------------------
test('1. core grid math is exact on the (duration + buffer) grid', () => {
  const config = {
    timezone: 'UTC',
    slot_duration_minutes: 60,
    buffer_minutes: 0,
    capacity: 1,
    operating_hours: {},
    blackout_dates: [],
    min_advance_hours: 1,
    max_advance_days: 90,
  };
  const slots = availableSlots({ config, nowUtc: new Date('2026-09-19T12:00:00.000Z'), count: 3 });
  assert.equal(slots.length, 3);
  assert.equal(slots[0].start.toISOString(), '2026-09-19T13:00:00.000Z');
  assert.equal(slots[1].start.toISOString(), '2026-09-19T14:00:00.000Z');
  assert.equal(slots[2].start.toISOString(), '2026-09-19T15:00:00.000Z');
  assert.equal(slots[0].localDate, '2026-09-19');
  for (const s of slots) assert.equal(s.end.getTime() - s.start.getTime(), 3600000);
});

test('2. buffer minutes widen the occupied interval on the grid', () => {
  const config = {
    timezone: 'UTC',
    slot_duration_minutes: 30,
    buffer_minutes: 15,
    capacity: 1,
    operating_hours: { 3: '10:00-12:00' },
    blackout_dates: [],
    min_advance_hours: 1,
    max_advance_days: 90,
  };
  const slots = availableSlots({
    config,
    nowUtc: new Date('2026-09-19T12:00:00.000Z'),
    fromUtc: new Date('2026-09-23T00:00:00.000Z'),
  });
  assert.equal(slots[0].localDate, '2026-09-23', '09/23 is the next Wednesday');
  assert.equal(slots[0].start.toISOString(), '2026-09-23T10:00:00.000Z');
  assert.equal(slots[0].end.toISOString(), '2026-09-23T10:45:00.000Z');
  assert.equal(slots[1].start.toISOString(), '2026-09-23T10:45:00.000Z');
  assert.equal(slots[2].localDate, '2026-09-30', 'generation continues to later Wednesdays');
  for (const s of slots) assert.equal(s.end.getTime() - s.start.getTime(), 2700000);
  assert.ok(isExactSlot({ config, start: slots[0].start, end: slots[0].end, nowUtc: new Date('2026-09-19T12:00:00.000Z') }));
  assert.ok(!isExactSlot({
    config,
    start: new Date('2026-09-23T10:30:00.000Z'),
    end: new Date('2026-09-23T11:15:00.000Z'),
  }));
});

test('3. slot tokens are signed, tamper-evident and secret-scoped', () => {
  const secret = 'unit-secret';
  const start = new Date('2026-09-19T13:00:00.000Z');
  const end = new Date('2026-09-19T14:00:00.000Z');
  const token = issueSlotToken({ secret, businessId: 'b', productId: 'p', configVersion: 7, start, end });
  assert.ok(token.includes('.'));
  const parsed = parseSlotToken({ secret, token });
  assert.deepEqual({
    businessId: parsed.businessId,
    productId: parsed.productId,
    configVersion: parsed.configVersion,
  }, { businessId: 'b', productId: 'p', configVersion: 7 });
  assert.equal(parsed.start.toISOString(), start.toISOString());
  assert.equal(parsed.end.toISOString(), end.toISOString());
  const flipped = token.endsWith('a') ? token.slice(0, -1) + 'b' : token.slice(0, -1) + 'a';
  assert.equal(parseSlotToken({ secret, token: flipped }), null);
  assert.equal(parseSlotToken({ secret: 'other-secret', token }), null);
  assert.equal(parseSlotToken({ secret, token: 'garbage' }), null);
});

test('4. booking config normalization rejects anything that could widen availability', () => {
  const base = {
    timezone: 'Africa/Lagos',
    slot_duration_minutes: 30,
    buffer_minutes: 0,
    capacity: 1,
    operating_hours: {},
  };
  assert.ok(normalizeBookingConfig({ ...base, timezone: 'Mars/Olympus' }).error);
  assert.ok(normalizeBookingConfig({ ...base, capacity: 0 }).error);
  assert.ok(normalizeBookingConfig({ ...base, capacity: BOOKING_CONSTRAINTS.capacityMax + 1 }).error);
  assert.ok(normalizeBookingConfig({ ...base, slot_duration_minutes: BOOKING_CONSTRAINTS.slotDurationMax + 1 }).error);
  assert.ok(normalizeBookingConfig({ ...base, buffer_minutes: BOOKING_CONSTRAINTS.bufferMax + 1 }).error);
  assert.ok(normalizeBookingConfig({ ...base, operating_hours: { 7: '10:00-12:00' } }).error);
  assert.ok(normalizeBookingConfig({ ...base, operating_hours: { 2: '12:00-10:00' } }).error);
  assert.ok(normalizeBookingConfig({ ...base, blackout_dates: ['04/07/2027'] }).error);
  assert.ok(normalizeBookingConfig({ ...base, auto_confirm: 'yes' }).error);
  const ok = normalizeBookingConfig(base);
  assert.ok(!ok.error);
  assert.equal(ok.value.slot_duration_minutes, 30);
  assert.deepEqual(ok.value.operating_hours, {});
  assert.equal(ok.value.allow_reschedule, true);
  assert.equal(ok.value.requires_payment, false);
});

test('5. lifecycle transitions are a closed state machine', () => {
  assert.ok(canTransition(BOOKING_STATUSES.RESERVED, BOOKING_STATUSES.CONFIRMED));
  assert.ok(canTransition(BOOKING_STATUSES.RESERVED, BOOKING_STATUSES.CANCELLED));
  assert.ok(canTransition(BOOKING_STATUSES.CONFIRMED, BOOKING_STATUSES.COMPLETED));
  assert.ok(canTransition(BOOKING_STATUSES.CONFIRMED, BOOKING_STATUSES.NO_SHOW));
  assert.ok(canTransition(BOOKING_STATUSES.CONFIRMED, BOOKING_STATUSES.CANCELLED));
  assert.ok(!canTransition(BOOKING_STATUSES.RESERVED, BOOKING_STATUSES.COMPLETED));
  assert.ok(!canTransition(BOOKING_STATUSES.RESERVED, BOOKING_STATUSES.NO_SHOW));
  assert.ok(!canTransition(BOOKING_STATUSES.COMPLETED, BOOKING_STATUSES.CANCELLED));
});

// ---- HTTP fixtures ----------------------------------------------------------
test('setup: tenants, agents, touchpoints, products and booking configs', async () => {
  businessA = (await register({
    email: 'iota@phase13c.test',
    password: 'password123',
    name: 'Iota Owner',
    businessName: 'Iota Clinics',
  })).body;
  assert.ok(businessA.token);

  businessB = (await register({
    email: 'kappa@phase13c.test',
    password: 'password123',
    name: 'Kappa Owner',
    businessName: 'Kappa Rooms',
  })).body;
  assert.ok(businessB.token);

  agentAId = (await createAgent(businessA.token, 'Iota Receptionist')).body.agent.id;
  agentBId = (await createAgent(businessB.token, 'Kappa Concierge')).body.agent.id;

  tpA = (await createTouchpoint(businessA.token, { name: 'Iota Landing', agentId: agentAId })).body.touchpoint;
  tpB = (await createTouchpoint(businessB.token, { name: 'Kappa Landing', agentId: agentBId })).body.touchpoint;
  assert.ok(tpA.trackingId);
  assert.ok(tpB.trackingId);

  prodConsult = (await createProduct(businessA.token, { name: 'Consultation', price: 0, currency: 'NGN' })).body.product;
  prodNy = (await createProduct(businessA.token, { name: 'NY Session', price: 0, currency: 'NGN' })).body.product;
  prodWed = (await createProduct(businessA.token, { name: 'Wednesday Workshop', price: 0, currency: 'NGN' })).body.product;
  prodGroup = (await createProduct(businessA.token, { name: 'Group Coaching', price: 0, currency: 'NGN' })).body.product;
  prodFlex = (await createProduct(businessA.token, { name: 'Flex Session', price: 0, currency: 'NGN' })).body.product;
  prodCross = (await createProduct(businessB.token, { name: 'B Product', price: 0, currency: 'NGN' })).body.product;

  assert.equal(prodConsult.bookable, false);

  const consultConfig = (await putConfig(businessA.token, prodConsult.id, {
    timezone: 'Africa/Lagos', slot_duration_minutes: 60, buffer_minutes: 0, capacity: 1,
    operating_hours: {}, blackout_dates: [], min_advance_hours: 1, max_advance_days: 90,
    auto_confirm: true, hold_minutes: 15, allow_reschedule: true, requires_payment: false,
  })).body.config;
  assert.equal(consultConfig.configVersion, 1);
  assert.equal(consultConfig.productBookable, true);

  await putConfig(businessA.token, prodNy.id, {
    timezone: 'America/New_York', slot_duration_minutes: 60, buffer_minutes: 0, capacity: 1,
    operating_hours: {
      0: '09:00-17:00', 1: '09:00-17:00', 2: '09:00-17:00', 3: '09:00-17:00',
      4: '09:00-17:00', 5: '09:00-17:00', 6: '09:00-17:00',
    },
    blackout_dates: [], min_advance_hours: 1, max_advance_days: 365, auto_confirm: true,
  });

  await putConfig(businessA.token, prodWed.id, {
    timezone: 'Africa/Lagos', slot_duration_minutes: 30, buffer_minutes: 15, capacity: 1,
    operating_hours: { 3: '10:00-12:00' }, blackout_dates: ['2027-04-07'],
    min_advance_hours: 1, max_advance_days: 365, auto_confirm: true,
  });

  await putConfig(businessA.token, prodGroup.id, {
    timezone: 'Africa/Lagos', slot_duration_minutes: 60, buffer_minutes: 0, capacity: 2,
    operating_hours: {}, blackout_dates: [], min_advance_hours: 1, max_advance_days: 90, auto_confirm: true,
  });

  await putConfig(businessA.token, prodFlex.id, {
    timezone: 'Africa/Lagos', slot_duration_minutes: 60, buffer_minutes: 0, capacity: 1,
    operating_hours: {}, blackout_dates: [], min_advance_hours: 1, max_advance_days: 90,
    auto_confirm: false, hold_minutes: 15, allow_reschedule: true,
  });

  // Tenant B's own bookable product is configured here, in setup.
  await putConfig(businessB.token, prodCross.id, {
    timezone: 'Africa/Lagos', slot_duration_minutes: 60, buffer_minutes: 0, capacity: 1,
    operating_hours: {}, blackout_dates: [], min_advance_hours: 1, max_advance_days: 90,
    auto_confirm: true,
  });

  const listed = (await listProducts(businessA.token, '?bookable=true')).body.products;
  assert.deepEqual(listed.map((p) => p.id).sort(), [prodConsult.id, prodNy.id, prodWed.id, prodGroup.id, prodFlex.id].sort());

  // A config edit bumps config_version (fresh availability must be re-fetched).
  const bumped = (await putConfig(businessA.token, prodConsult.id, {
    timezone: 'Africa/Lagos', slot_duration_minutes: 60, buffer_minutes: 0, capacity: 1,
    operating_hours: {}, blackout_dates: [], min_advance_hours: 1, max_advance_days: 90,
    auto_confirm: true, hold_minutes: 15, allow_reschedule: true, requires_payment: false,
  })).body.config;
  assert.equal(bumped.configVersion, 2);
});
test('6. config surface rejects invalid payloads and deletes cleanly', async () => {
  assert.equal((await putConfig(businessB.token, prodCross.id, { timezone: 'Not/AZone', slot_duration_minutes: 30 })).status, 400);
  assert.equal((await putConfig(businessA.token, prodCross.id, { timezone: 'Africa/Lagos', slot_duration_minutes: 30 })).status, 404);
  assert.equal((await putConfig(businessA.token, prodWed.id, { timezone: 'Africa/Lagos', slot_duration_minutes: BOOKING_CONSTRAINTS.slotDurationMax + 1 })).status, 400);
  assert.equal((await putConfig(businessA.token, prodWed.id, { timezone: 'Africa/Lagos', slot_duration_minutes: 30, capacity: 0 })).status, 400);
  assert.equal((await putConfig(businessA.token, prodWed.id, { timezone: 'Africa/Lagos', slot_duration_minutes: 30, operating_hours: { 8: '10:00-12:00' } })).status, 400);
  assert.equal((await putConfig(businessA.token, prodWed.id, { timezone: 'Africa/Lagos', slot_duration_minutes: 30, blackout_dates: ['2027-04-07T00:00:00Z'] })).status, 400);

  const removed = (await deleteConfig(businessA.token, prodWed.id)).body;
  assert.equal(removed.deleted, true);
  const mirrored = (await listProducts(businessA.token, '?bookable=true')).body.products;
  assert.ok(!mirrored.some((p) => p.id === prodWed.id));

  // Restore prodWed's config for later grid tests.
  await putConfig(businessA.token, prodWed.id, {
    timezone: 'Africa/Lagos', slot_duration_minutes: 30, buffer_minutes: 15, capacity: 1,
    operating_hours: { 3: '10:00-12:00' }, blackout_dates: ['2027-04-07'],
    min_advance_hours: 1, max_advance_days: 365, auto_confirm: true,
  });
});

test('7. 24/7 availability: aligned, gap-free, exact, token-bearing slots', async () => {
  await clearBookings(prodConsult.id);
  const res = await available(tpA.trackingId, { productId: prodConsult.id, count: 10 });
  assert.equal(res.status, 200);
  assert.equal(res.body.product.id, prodConsult.id);
  assert.equal(res.body.timezone, 'Africa/Lagos');
  assert.equal(res.body.slots.length, 10);
  for (let i = 0; i < res.body.slots.length; i++) {
    const s = res.body.slots[i];
    assert.equal(s.durationMinutes, 60);
    assert.equal(slotMinutes(s), 60);
    assert.equal(s.available, true);
    assert.ok(s.token && s.token.includes('.'));
    assert.ok(s.localStart.endsWith(':00'), `${s.localStart} should be hour-aligned`);
    if (i > 0) assert.equal(res.body.slots[i].startUtc, res.body.slots[i - 1].endUtc, 'consecutive slots must be gap-free');
  }
  assert.ok(new Date(res.body.slots[0].startUtc).getTime() > Date.now(), 'earliest slot respects min_advance_hours');
});

test('8. DST-safe grid across the US spring-forward boundary', async () => {
  const res = await available(tpA.trackingId, { productId: prodNy.id, from: '2027-03-13T00:00:00.000Z', count: 20 });
  assert.equal(res.status, 200);
  const slots = res.body.slots;
  assert.equal(slots.length, 20);
  // Sat Mar 13 is EST (UTC-5): local 09:00 == 14:00 UTC.
  assert.equal(slots[0].localDate, '2027-03-13');
  assert.equal(slots[0].localStart, '09:00');
  assert.equal(slots[0].startUtc, '2027-03-13T14:00:00.000Z');
  // Sun Mar 14 is EDT (UTC-4) after the 2am spring-forward: 09:00 == 13:00 UTC.
  const sunday = slots.find((s) => s.localDate === '2027-03-14');
  assert.ok(sunday, 'spring-forward Sunday must still produce exact slots');
  assert.equal(sunday.localStart, '09:00');
  assert.equal(sunday.startUtc, '2027-03-14T13:00:00.000Z');
  // Every slot stays exactly 60 minutes across the transition, aligned to 09:00..16:00 local.
  for (const s of slots) {
    assert.equal(slotMinutes(s), 60);
    assert.ok(s.localStart >= '09:00' && s.localStart <= '16:00', s.localStart);
  }
});

test('9. operating hours, buffers and blackout dates are honored exactly', async () => {
  const res = await available(tpA.trackingId, { productId: prodWed.id, from: '2027-04-01T00:00:00.000Z', count: 10 });
  assert.equal(res.status, 200);
  const slots = res.body.slots;
  // Wed Apr 7 is blacked out; Wednesdays open 10:00-12:00 with a 45-minute
  // occupied interval (30 slot + 15 buffer), so exactly two slots fit per day.
  assert.equal(slots.length, 10);
  assert.equal(slots[0].localDate, '2027-04-14', 'first open Wednesday after the blackout');
  assert.equal(slots[0].localStart, '10:00');
  assert.equal(slots[0].localEnd, '10:45');
  assert.equal(slots[0].startUtc, '2027-04-14T09:00:00.000Z');
  assert.equal(slots[0].endUtc, '2027-04-14T09:45:00.000Z');
  assert.equal(slots[1].localDate, '2027-04-14');
  assert.equal(slots[1].localStart, '10:45');
  assert.equal(slots[1].localEnd, '11:30');
  assert.equal(slots[2].localDate, '2027-04-21', 'generation continues to later Wednesdays');
  assert.equal(slots[0].durationMinutes, 30, 'duration excludes the buffer');
  assert.ok(!slots.some((s) => s.localDate === '2027-04-07'), 'blackout date never opens');
  for (const s of slots) assert.equal(s.available, true);
});

test('10. advance bounds clamp availability and can produce an empty horizon', async () => {
  const beyond = await available(tpA.trackingId, { productId: prodConsult.id, from: new Date(Date.now() + 91 * 86400000).toISOString() });
  assert.equal(beyond.body.slots.length, 0);
  assert.equal((await available(tpA.trackingId, { productId: prodConsult.id })).body.slots.length, 10);
});

test('11. reserve creates a booking with server-decided status only', async () => {
  await clearBookings(prodConsult.id);
  const slots = (await available(tpA.trackingId, { productId: prodConsult.id, count: 10 })).body.slots;
  const target = slots[2];
  const res = await reserve(tpA.trackingId, {
    productId: prodConsult.id,
    token: target.token,
    customer: { name: 'Ada Lovelace', phone: '08012345678' },
    idempotencyKey: 'phase13c-key-001',
  });
  assert.equal(res.status, 201);
  const booking = res.body.booking;
  assert.equal(booking.productId, prodConsult.id);
  assert.equal(booking.status, 'confirmed', 'auto_confirm + no requires_payment => confirmed');
  assert.equal(booking.requestedStartAt, target.startUtc);
  assert.equal(booking.endAt, target.endUtc);
  assert.equal(booking.holdUntil, null);
  assert.equal(booking.phone, '08012345678');
  const row = await bookingRow(booking.id);
  assert.equal(row.idempotency_key, 'phase13c-key-001');
  assert.equal(row.status, 'confirmed');
});

test('12. idempotency: the same key returns the same booking, no double insert', async () => {
  await clearBookings(prodConsult.id);
  const slot = (await available(tpA.trackingId, { productId: prodConsult.id, count: 10 })).body.slots[2];
  const first = await reserve(tpA.trackingId, {
    productId: prodConsult.id, token: slot.token, customer: { name: 'Grace' }, idempotencyKey: 'key-idem-1',
  });
  assert.equal(first.status, 201);
  const second = await reserve(tpA.trackingId, {
    productId: prodConsult.id, token: slot.token, customer: { name: 'Grace' }, idempotencyKey: 'key-idem-1',
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.booking.id, first.body.booking.id);
  const all = (await listBookings(businessA.token, `?productId=${prodConsult.id}`)).body.bookings;
  assert.equal(all.length, 1);

  const diffKey = await reserve(tpA.trackingId, {
    productId: prodConsult.id, token: slot.token, customer: { name: 'Eve' }, idempotencyKey: 'key-idem-2',
  });
  assert.equal(diffKey.status, 409);
  assert.equal(diffKey.body.code, 'SLOT_NOT_AVAILABLE');
});

test('13. occupancy is reflected in availability and frees on cancel', async () => {
  await clearBookings(prodConsult.id);
  const before = (await available(tpA.trackingId, { productId: prodConsult.id, count: 10 })).body.slots;
  const targetStart = before[3].startUtc;
  const reserved = await reserve(tpA.trackingId, {
    productId: prodConsult.id, token: before[3].token, customer: { name: 'Alan' }, idempotencyKey: 'key-occur-1',
  });
  assert.equal(reserved.status, 201);

  const during = (await available(tpA.trackingId, { productId: prodConsult.id, count: 10 })).body.slots;
  const taken = during.find((s) => s.startUtc === targetStart);
  assert.equal(taken.available, false);
  assert.equal(taken.token, null);
  assert.equal(during.filter((s) => s.startUtc !== targetStart).every((s) => s.available), true);

  const cancelled = await bookingAction(businessA.token, reserved.body.booking.id, 'cancel', { reason: 'no longer needed' });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.booking.status, 'cancelled');

  const afterCancel = (await available(tpA.trackingId, { productId: prodConsult.id, count: 10 })).body.slots;
  const freed = afterCancel.find((s) => s.startUtc === targetStart);
  assert.equal(freed.available, true);
  assert.ok(freed.token);
});

test('14. concurrent reserves on one slot: exactly one wins under the advisory lock', async () => {
  await clearBookings(prodConsult.id);
  const slot = (await available(tpA.trackingId, { productId: prodConsult.id, count: 10 })).body.slots[2];
  const [a, b] = await Promise.all([
    reserve(tpA.trackingId, { productId: prodConsult.id, token: slot.token, customer: { name: 'One' }, idempotencyKey: 'race-1' }),
    reserve(tpA.trackingId, { productId: prodConsult.id, token: slot.token, customer: { name: 'Two' }, idempotencyKey: 'race-2' }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  const loser = a.status === 409 ? a : b;
  assert.equal(loser.body.code, 'SLOT_NOT_AVAILABLE');
});

test('15. capacity N vs N+1 on a capacity-2 product', async () => {
  await clearBookings(prodGroup.id);
  const slot = (await available(tpA.trackingId, { productId: prodGroup.id, count: 10 })).body.slots[2];
  const first = await reserve(tpA.trackingId, { productId: prodGroup.id, token: slot.token, customer: { name: 'One' }, idempotencyKey: 'cap-1' });
  const second = await reserve(tpA.trackingId, { productId: prodGroup.id, token: slot.token, customer: { name: 'Two' }, idempotencyKey: 'cap-2' });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);

  const full = (await available(tpA.trackingId, { productId: prodGroup.id, count: 10 })).body.slots.find((s) => s.startUtc === slot.startUtc);
  assert.equal(full.available, false);
  assert.equal(full.token, null);

  const over = await reserve(tpA.trackingId, { productId: prodGroup.id, token: slot.token, customer: { name: 'Three' }, idempotencyKey: 'cap-3' });
  assert.equal(over.status, 409);
  assert.equal(over.body.code, 'SLOT_NOT_AVAILABLE');
});

test('16. lifecycle: reserved -> confirmed -> completed plus illegal transitions', async () => {
  await clearBookings(prodFlex.id);
  const slot = (await available(tpA.trackingId, { productId: prodFlex.id, count: 10 })).body.slots[2];
  const reserved = await reserve(tpA.trackingId, {
    productId: prodFlex.id, token: slot.token, customer: { name: 'Leia' }, idempotencyKey: 'life-1',
  });
  assert.equal(reserved.status, 201);
  assert.equal(reserved.body.booking.status, 'reserved');
  assert.ok(new Date(reserved.body.booking.holdUntil).getTime() > Date.now());

  const directComplete = await bookingAction(businessA.token, reserved.body.booking.id, 'complete');
  assert.equal(directComplete.status, 409);
  assert.equal(directComplete.body.code, 'INVALID_TRANSITION');

  const confirmed = await bookingAction(businessA.token, reserved.body.booking.id, 'confirm');
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.booking.status, 'confirmed');
  assert.equal(confirmed.body.booking.holdUntil, null);

  const completed = await bookingAction(businessA.token, reserved.body.booking.id, 'complete');
  assert.equal(completed.status, 200);
  assert.equal(completed.body.booking.status, 'completed');

  const cancelAfter = await bookingAction(businessA.token, reserved.body.booking.id, 'cancel');
  assert.equal(cancelAfter.status, 409);
  assert.equal(cancelAfter.body.code, 'INVALID_TRANSITION');
});

test('17. confirmed bookings reach no-show; nothing after no-show moves', async () => {
  await clearBookings(prodFlex.id);
  const slot = (await available(tpA.trackingId, { productId: prodFlex.id, count: 10 })).body.slots[3];
  const reserved = (await reserve(tpA.trackingId, {
    productId: prodFlex.id, token: slot.token, customer: { name: 'Maya' }, idempotencyKey: 'ns-1',
  })).body.booking;
  await bookingAction(businessA.token, reserved.id, 'confirm');
  const noShow = await bookingAction(businessA.token, reserved.id, 'no-show');
  assert.equal(noShow.status, 200);
  assert.equal(noShow.body.booking.status, 'no_show');
  assert.equal((await bookingAction(businessA.token, reserved.id, 'complete')).status, 409);
  assert.equal((await bookingAction(businessA.token, reserved.id, 'confirm')).status, 409);
});
test('18. reschedule is atomic, frees the old slot and records the move', async () => {
  await clearBookings(prodConsult.id);
  const before = (await available(tpA.trackingId, { productId: prodConsult.id, count: 10 })).body.slots;
  const fromStart = before[2].startUtc;
  const toSlot = before[5];
  const booking = (await reserve(tpA.trackingId, {
    productId: prodConsult.id, token: before[2].token, customer: { name: 'Res' }, idempotencyKey: 'res-1',
  })).body.booking;

  const moved = await bookingAction(businessA.token, booking.id, 'reschedule', { token: toSlot.token });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.booking.requestedStartAt, toSlot.startUtc);
  assert.equal(moved.body.booking.endAt, toSlot.endUtc);
  assert.ok(Array.isArray(moved.body.booking.metadata.reschedule));
  assert.equal(moved.body.booking.metadata.reschedule[0].from.requestedStartAt, fromStart);
  assert.equal(moved.body.booking.metadata.reschedule[0].to.requestedStartAt, toSlot.startUtc);

  const after = (await available(tpA.trackingId, { productId: prodConsult.id, count: 10 })).body.slots;
  assert.equal(after.find((s) => s.startUtc === fromStart).available, true, 'old slot freed');
  assert.equal(after.find((s) => s.startUtc === toSlot.startUtc).available, false, 'new slot occupied');
});

test('19. rescheduling is refused when disabled or into a full slot', async () => {
  // Disabled on prodFlex after a config bump (tokens from before are now stale).
  await clearBookings(prodFlex.id);
  await putConfig(businessA.token, prodFlex.id, {
    timezone: 'Africa/Lagos', slot_duration_minutes: 60, buffer_minutes: 0, capacity: 1,
    operating_hours: {}, blackout_dates: [], min_advance_hours: 1, max_advance_days: 90,
    auto_confirm: false, hold_minutes: 15, allow_reschedule: false,
  });
  const flexSlots = (await available(tpA.trackingId, { productId: prodFlex.id, count: 10 })).body.slots;
  const flexBooking = (await reserve(tpA.trackingId, {
    productId: prodFlex.id, token: flexSlots[2].token, customer: { name: 'NoMove' }, idempotencyKey: 'nodisable-1',
  })).body.booking;
  const refused = await bookingAction(businessA.token, flexBooking.id, 'reschedule', { token: flexSlots[4].token });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'RESCHEDULE_DISABLED');

  // Full destination on the capacity-2 product: two others already hold it.
  await clearBookings(prodGroup.id);
  const groupSlots = (await available(tpA.trackingId, { productId: prodGroup.id, count: 10 })).body.slots;
  const dest = groupSlots[2];
  const other = groupSlots[4];
  const toMove = (await reserve(tpA.trackingId, {
    productId: prodGroup.id, token: other.token, customer: { name: 'Mover' }, idempotencyKey: 'full-dest-0',
  })).body.booking;
  assert.equal((await reserve(tpA.trackingId, { productId: prodGroup.id, token: dest.token, customer: { name: 'Hold1' }, idempotencyKey: 'full-dest-1' })).status, 201);
  assert.equal((await reserve(tpA.trackingId, { productId: prodGroup.id, token: dest.token, customer: { name: 'Hold2' }, idempotencyKey: 'full-dest-2' })).status, 201);
  const blocked = await bookingAction(businessA.token, toMove.id, 'reschedule', { token: dest.token });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'SLOT_NOT_AVAILABLE');
});

test('20. reserved holds expire; confirmed bookings never do', async () => {
  await clearBookings(prodFlex.id);
  // Restore allow_reschedule with auto-confirm off for the expiry run.
  await putConfig(businessA.token, prodFlex.id, {
    timezone: 'Africa/Lagos', slot_duration_minutes: 60, buffer_minutes: 0, capacity: 1,
    operating_hours: {}, blackout_dates: [], min_advance_hours: 1, max_advance_days: 90,
    auto_confirm: false, hold_minutes: 15, allow_reschedule: true,
  });
  const slots = (await available(tpA.trackingId, { productId: prodFlex.id, count: 10 })).body.slots;
  const start = slots[2].startUtc;
  const b = (await reserve(tpA.trackingId, {
    productId: prodFlex.id, token: slots[2].token, customer: { name: 'Timely' }, idempotencyKey: 'exp-1',
  })).body.booking;
  assert.equal(b.status, 'reserved');
  await forceHoldExpired(b.id);

  const expired = await expireStale(businessA.token);
  assert.equal(expired.status, 200);
  assert.equal(expired.body.expired, 1);
  assert.deepEqual(expired.body.bookingIds, [b.id]);
  assert.equal((await getBooking(businessA.token, b.id)).body.booking.status, 'expired');

  const freed = (await available(tpA.trackingId, { productId: prodFlex.id, count: 10 })).body.slots.find((s) => s.startUtc === start);
  assert.equal(freed.available, true);

  // A confirmed booking (hold_until null even if forced) is not expirable.
  await clearBookings(prodConsult.id);
  const cs = (await available(tpA.trackingId, { productId: prodConsult.id, count: 10 })).body.slots[2];
  const confirmed = (await reserve(tpA.trackingId, {
    productId: prodConsult.id, token: cs.token, customer: { name: 'Solid' }, idempotencyKey: 'conf-exp-1',
  })).body.booking;
  assert.equal(confirmed.status, 'confirmed');
  await forceHoldExpired(confirmed.id);
  const again = await expireStale(businessA.token);
  assert.equal(again.body.expired, 0);
  assert.equal((await getBooking(businessA.token, confirmed.id)).body.booking.status, 'confirmed');
});

test('21. stale slot tokens are rejected once the config changes; tampered tokens too', async () => {
  await clearBookings(prodConsult.id);
  const before = (await available(tpA.trackingId, { productId: prodConsult.id, count: 10 })).body.slots;
  const token = before[2].token;
  await putConfig(businessA.token, prodConsult.id, {
    timezone: 'Africa/Lagos', slot_duration_minutes: 60, buffer_minutes: 0, capacity: 1,
    operating_hours: {}, blackout_dates: [], min_advance_hours: 2, max_advance_days: 90,
    auto_confirm: true, hold_minutes: 15, allow_reschedule: true, requires_payment: false,
  });
  const res = await reserve(tpA.trackingId, { productId: prodConsult.id, token, customer: { name: 'OldToken' }, idempotencyKey: 'stale-1' });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'STALE_SLOT');

  const tampered = await reserve(tpA.trackingId, { productId: prodConsult.id, token: `${token.slice(0, -3)}abc`, customer: { name: 'Tamper' }, idempotencyKey: 'stale-2' });
  assert.equal(tampered.status, 400);
  assert.equal(tampered.body.code, 'INVALID_SLOT_TOKEN');

  // Restore the main config (version bump) so later tests use fresh tokens.
  await putConfig(businessA.token, prodConsult.id, {
    timezone: 'Africa/Lagos', slot_duration_minutes: 60, buffer_minutes: 0, capacity: 1,
    operating_hours: {}, blackout_dates: [], min_advance_hours: 1, max_advance_days: 90,
    auto_confirm: true, hold_minutes: 15, allow_reschedule: true, requires_payment: false,
  });
});

test('22. customers get availability/reserve only; everything else is locked', async () => {
  assert.equal((await request(`/v1/t/${tpA.trackingId}/booking/available`)).status, 400, 'productId required');
  assert.equal((await available(tpA.trackingId, { productId: prodConsult.id })).status, 200, 'public availability needs no auth');
  assert.equal((await listBookings('', '')).status, 401);
  assert.equal((await getConfigs('')).status, 401);
  assert.equal((await request('/v1/bookings/expire-stale', { method: 'POST' })).status, 401);
  assert.equal((await listBookings(businessA.token, '?status=shark')).status, 200, 'unknown status filter is ignored');

  const deactivated = await updateTouchpoint(businessA.token, tpA.id, { active: false });
  assert.equal(deactivated.status, 200);
  assert.equal((await available(tpA.trackingId, { productId: prodConsult.id })).status, 410);
  assert.equal((await reserve(tpA.trackingId, { productId: prodConsult.id, token: 'x.y' })).status, 410);
  await updateTouchpoint(businessA.token, tpA.id, { active: true });
  assert.equal((await available(tpA.trackingId, { productId: prodConsult.id })).status, 200);
});

test('23. tenant isolation: cross-tenant reads and writes are all 404/empty', async () => {
  await clearBookings(prodConsult.id);
  const slot = (await available(tpA.trackingId, { productId: prodConsult.id, count: 10 })).body.slots[2];
  const privateBooking = (await reserve(tpA.trackingId, {
    productId: prodConsult.id, token: slot.token, customer: { name: 'Isolated' }, idempotencyKey: 'iso-1',
  })).body.booking;

  const aConfigs = (await getConfigs(businessA.token)).body.configs;
  assert.ok(!aConfigs.some((c) => c.productId === prodCross.id), 'A never sees B configs');
  const bConfigs = (await getConfigs(businessB.token)).body.configs;
  assert.deepEqual(bConfigs.map((c) => c.productId), [prodCross.id], 'B sees only its own config');
  assert.equal((await putConfig(businessB.token, prodConsult.id, { timezone: 'Africa/Lagos', slot_duration_minutes: 30 })).status, 404);
  assert.equal((await getBooking(businessB.token, privateBooking.id)).status, 404);
  assert.equal((await bookingAction(businessB.token, privateBooking.id, 'cancel')).status, 404);
  assert.equal((await bookingAction(businessB.token, privateBooking.id, 'confirm')).status, 404);

  // A's touchpoint cannot see B's product and vice versa.
  assert.equal((await available(tpA.trackingId, { productId: prodCross.id })).status, 404);
  assert.equal((await available(tpB.trackingId, { productId: prodConsult.id })).status, 404);

  const bSlots = (await available(tpB.trackingId, { productId: prodCross.id, count: 10 })).body.slots;
  assert.ok(bSlots.length > 0, 'B has its own availability');
  const bRes = await reserve(tpB.trackingId, {
    productId: prodCross.id, token: bSlots[2].token, customer: { name: 'Boss' }, idempotencyKey: 'iso-b-1',
  });
  assert.equal(bRes.status, 201);
  assert.equal((await getBooking(businessA.token, bRes.body.booking.id)).status, 404);
  assert.deepEqual((await listBookings(businessA.token, `?productId=${prodCross.id}`)).body.bookings, []);
});

test('24. BOOK executor books the exact server-issued slot', async () => {
  await clearBookings(prodConsult.id);
  const slots = (await available(tpA.trackingId, { productId: prodConsult.id, count: 10 })).body.slots;
  const token = slots[3].token;
  const proposed = await proposeAction(businessA.token, {
    actionType: 'BOOK',
    productId: prodConsult.id,
    customer: { name: 'Bookie', phone: '08055555555' },
    metadata: { slotToken: token },
  });
  assert.equal(proposed.status, 201);
  assert.equal(proposed.body.action.actionType, 'BOOK');
  assert.equal(proposed.body.action.status, 'proposed');

  const executed = await executeAction(businessA.token, proposed.body.action.id);
  assert.equal(executed.status, 200);
  assert.equal(executed.body.action.status, 'executed');
  assert.equal(executed.body.action.metadata.bookingId, executed.body.booking.id);
  assert.equal(executed.body.booking.status, 'confirmed');
  assert.equal(executed.body.booking.requestedStartAt, slots[3].startUtc);

  // Execute again is refused (already executed).
  assert.equal((await executeAction(businessA.token, proposed.body.action.id)).status, 409);

  // A BOOK action with no slot token cannot execute.
  const noToken = (await proposeAction(businessA.token, { actionType: 'BOOK', productId: prodConsult.id })).body.action;
  const noTokenExec = await executeAction(businessA.token, noToken.id);
  assert.equal(noTokenExec.status, 409);
  assert.equal(noTokenExec.body.code, 'ACTION_NOT_EXECUTABLE');

  // A BOOK action with a stale slot token fails and the action stays proposed.
  const staleSlot = (await available(tpA.trackingId, { productId: prodConsult.id, count: 10 })).body.slots[4];
  await putConfig(businessA.token, prodConsult.id, {
    timezone: 'Africa/Lagos', slot_duration_minutes: 60, buffer_minutes: 0, capacity: 1,
    operating_hours: {}, blackout_dates: [], min_advance_hours: 2, max_advance_days: 90,
    auto_confirm: true, hold_minutes: 15, allow_reschedule: true, requires_payment: false,
  });
  const staleProposed = (await proposeAction(businessA.token, {
    actionType: 'BOOK',
    productId: prodConsult.id,
    metadata: { slotToken: staleSlot.token },
  })).body.action;
  const staleExec = await executeAction(businessA.token, staleProposed.id);
  assert.equal(staleExec.status, 409);
  assert.equal(staleExec.body.code, 'STALE_SLOT');

  // Restore the main config so the funnel + AI + payment tests use fresh tokens.
  await putConfig(businessA.token, prodConsult.id, {
    timezone: 'Africa/Lagos', slot_duration_minutes: 60, buffer_minutes: 0, capacity: 1,
    operating_hours: {}, blackout_dates: [], min_advance_hours: 1, max_advance_days: 90,
    auto_confirm: true, hold_minutes: 15, allow_reschedule: true, requires_payment: false,
  });
});

test('25. lifecycle transitions emit booking funnel events, deduped per event', async () => {
  await clearBookings(prodFlex.id);
  const slot = (await available(tpA.trackingId, { productId: prodFlex.id, count: 10 })).body.slots[2];
  const b = (await reserve(tpA.trackingId, {
    productId: prodFlex.id, token: slot.token, customer: { name: 'Funny' }, idempotencyKey: 'funnel-1',
  })).body.booking;
  const confirmOnce = await bookingAction(businessA.token, b.id, 'confirm');
  assert.equal(confirmOnce.status, 200);
  const confirmAgain = await bookingAction(businessA.token, b.id, 'confirm');
  assert.equal(confirmAgain.status, 200);

  const rows = await funnelRowsFor(businessA.business.id);
  assert.equal(countFunnel(rows, 'booking_reserved', `booking:${b.id}`), 1);
  assert.equal(countFunnel(rows, 'booking_confirmed', `booking:${b.id}`), 1);
});

test('26. the system prompt carries BOOKING RULES and only server-issued options', async () => {
  // Handoff channel makes offer_booking a legal next best action.
  assert.equal((await request('/v1/business/handoff', {
    method: 'PUT',
    token: businessA.token,
    body: { bookingUrl: 'https://iota.test/book' },
  })).status, 200);

  // The recommendation state is persisted on a real conversation owned by A.
  const convId = `conv-booking-${Date.now()}`;
  await testPool.query(
    `INSERT INTO conversations (id, business_id, touchpoint_id, agent_id, customer_name, target_language,
       stage, intent, customer_need, recommended_product_id, buying_signal, next_best_action, questions_asked, captured_lead_fields)
     VALUES ($1, $2, $3, $4, 'Ada', 'en', 'advance', 'buying_signal', 'Consultation', $5, true, 'offer_booking', '[]', '{}')`,
    [convId, businessA.business.id, tpA.id, agentAId, prodConsult.id]
  );

  const firstExpected = (await available(tpA.trackingId, { productId: prodConsult.id, count: 10 })).body.slots[0];
  const expectedLabel = `${firstExpected.localDate} ${firstExpected.localStart}-${firstExpected.localEnd} (Africa/Lagos)`;

  const res = await sandboxChat(businessA.token, {
    agentId: agentAId,
    conversationId: convId,
    userInput: 'I want to book a consultation',
    targetLanguage: 'en',
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.text && res.body.text.length > 0);
  assert.ok(lastSystemPrompt.includes('BOOKING RULES (server-authoritative'), 'rules block present');
  assert.ok(lastSystemPrompt.includes('BOOKABLE OPTIONS (exactly these times, no others):'), 'options block present');
  assert.ok(lastSystemPrompt.includes(expectedLabel), `prompt must contain the server-issued option "${expectedLabel}"`);
  assert.ok(lastSystemPrompt.includes('NEVER tell the customer that a booking has been'), 'confirmation rule present');
});

test('27. a requires_payment product stays reserved until management confirms, and a booking never touches payments', async () => {
  await clearBookings(prodConsult.id);
  await putConfig(businessA.token, prodConsult.id, {
    timezone: 'Africa/Lagos', slot_duration_minutes: 60, buffer_minutes: 0, capacity: 1,
    operating_hours: {}, blackout_dates: [], min_advance_hours: 1, max_advance_days: 90,
    auto_confirm: true, hold_minutes: 15, allow_reschedule: true, requires_payment: true,
  });
  const slot = (await available(tpA.trackingId, { productId: prodConsult.id, count: 10 })).body.slots[2];
  const reserved = await reserve(tpA.trackingId, {
    productId: prodConsult.id, token: slot.token, customer: { name: 'PayMe' }, idempotencyKey: 'pay-1',
  });
  assert.equal(reserved.status, 201);
  assert.equal(reserved.body.booking.status, 'reserved', 'requires_payment suppresses auto_confirm');
  assert.ok(new Date(reserved.body.booking.holdUntil).getTime() > Date.now());

  // Booking flows never create or mutate orders / payment intents.
  assert.equal(await countTable('orders', businessA.business.id), 0);
  assert.equal(await countTable('payment_intents', businessA.business.id), 0);

  const rows = await funnelRowsFor(businessA.business.id);
  assert.equal(countFunnel(rows, 'booking_reserved', `booking:${reserved.body.booking.id}`), 1);
  assert.equal(countFunnel(rows, 'booking_confirmed', `booking:${reserved.body.booking.id}`), 0, 'not confirmed by reserve');

  const confirmed = await bookingAction(businessA.token, reserved.body.booking.id, 'confirm');
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.booking.status, 'confirmed');
  assert.equal(confirmed.body.booking.holdUntil, null);
  assert.equal((await getBooking(businessA.token, reserved.body.booking.id)).body.booking.status, 'confirmed');
});

test('28. deleting a booking config removes bookability end to end', async () => {
  const removed = (await deleteConfig(businessA.token, prodWed.id)).body;
  assert.equal(removed.deleted, true);
  const notBookable = await available(tpA.trackingId, { productId: prodWed.id, count: 5 });
  assert.equal(notBookable.status, 409);
  assert.equal(notBookable.body.code, 'NOT_BOOKABLE');
  const reserveAttempt = await reserve(tpA.trackingId, { productId: prodWed.id, token: 'x.y' });
  assert.equal(reserveAttempt.status, 409);
  assert.equal(reserveAttempt.body.code, 'NOT_BOOKABLE');
  const allProducts = (await listProducts(businessA.token, '?status=active')).body.products;
  const deletedProduct = allProducts.find((p) => p.id === prodWed.id);
  assert.ok(deletedProduct, 'product still exists');
  assert.equal(deletedProduct.bookable, false, 'product flag flipped off with the config');
});
