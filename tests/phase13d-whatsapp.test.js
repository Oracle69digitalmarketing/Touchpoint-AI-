/**
 * PHASE 13D — BATCH A: real WhatsApp Cloud API (Meta) webhook integration
 *
 * The Phase 13A mock boundary is gone. These tests exercise the production
 * webhook endpoint end to end: hub verification handshake, raw-body
 * X-Hub-Signature-256 verification (constant-time), tenant resolution purely
 * from the Meta phone_number_id, message-id idempotency, media-safety,
 * engine-fed text replies sent through the real adapter (substituted with a
 * deterministic transport via the _setWhatsAppHttp seam), provider failure
 * semantics (bounded retry vs permanent), and delivery/read/failed status
 * callbacks.
 *
 * The Groq client is swapped for the same deterministic fake used by Phase 13A
 * via _setGroqClient. PostgreSQL-backed against touchpoint_test.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb, cleanupTestDb } from './helpers/test-db.js';

process.env.JWT_SECRET = 'test-secret-for-phase13d-whatsapp';
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

const capturedTransports = [];
let transportMode = 'ok'; // 'ok' | 'retryable' | 'permanent'
let transportCalls = 0;
let transportErrors = 0;

_setWhatsAppHttp(async ({ url, accessToken, payload, timeoutMs }) => {
  transportCalls += 1;
  capturedTransports.push({ url, accessToken, payload, timeoutMs });
  if (transportMode === 'retryable' && transportErrors < 999) {
    transportErrors += 1;
    // A network-level failure (no response) — classified retryable.
    const err = new Error('ETIMEDOUT: request to graph.facebook.com timed out');
    err.request = {};
    throw err;
  }
  if (transportMode === 'permanent') {
    const err = new Error('Request failed with status code 400');
    err.response = { status: 400, data: { error: { code: 100, message: 'Invalid parameter', fbtrace_id: 'ABC' } } };
    throw err;
  }
  const id = `wamid.out.${transportCalls}.${Date.now()}`;
  return {
    data: {
      messaging_product: 'whatsapp',
      contacts: [{ input: payload.to, wa_id: payload.to }],
      messages: [{ id }],
    },
  };
});

_setPaystackHttp({
  async initialize({ reference, amount, email, currency }) {
    return { status: true, data: { reference, access_code: `acc_${reference}`, authorization_url: `https://checkout.paystack.com/${reference}` } };
  },
  async verify() {
    throw new Error('verify is not used by the Phase 13D suite');
  },
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

const request = async (url, { method = 'GET', body, token, rawBody = null, headers = {} } = {}) => {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (token) h['Authorization'] = `Bearer ${token}`;
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

// Signs the exact raw request bytes that will be delivered (same
// JSON.stringify serialization on both sides). Content-Type must be present so
// Express's body parser captures req.rawBody — the bytes the signature covers.
const signedEnvelope = (payload, { secret = process.env.WHATSAPP_APP_SECRET } = {}) => {
  const raw = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return { rawBody: raw, headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${sig}` } };
};

const webhook = (payload, overrides = {}) => {
  const { rawBody, headers } = signedEnvelope(payload, overrides);
  return request('/v1/channel/whatsapp/webhook', { method: 'POST', rawBody, headers });
};

const register = (payload) => request('/v1/auth/register', { method: 'POST', body: payload });

const waMessagesFor = async (businessId) => {
  const res = await testPool.query(
    'SELECT * FROM whatsapp_messages WHERE business_id = $1 ORDER BY created_at, id',
    [businessId]
  );
  return res.rows;
};

const conversationsFor = async (businessId) => {
  const res = await testPool.query(
    'SELECT id, channel, touchpoint_id FROM conversations WHERE business_id = $1 ORDER BY created_at',
    [businessId]
  );
  return res.rows;
};

const userMessagesFor = async (conversationId) => {
  const res = await testPool.query(
    'SELECT role, text FROM conversation_messages WHERE conversation_id = $1 ORDER BY created_at',
    [conversationId]
  );
  return res.rows;
};

// An outbound ledger row is correlated to the inbound message that triggered it
// via payload.inReplyTo (on success it ALSO carries the Meta wamid, but on
// failure there is no provider id yet — inReplyTo is authoritative for both).
const outboundReplyingTo = async (businessId, inboundWaId) => {
  const rows = await waMessagesFor(businessId);
  return rows.find((r) => r.direction === 'outbound' && r.payload && r.payload.inReplyTo === inboundWaId);
};

const counter = { n: 0 };
const inboundWamid = () => `wamid.inb.${Date.now()}.${(counter.n += 1)}`;

const messagesEnvelope = (phoneNumberId, { number = '+2348010000001', text = 'Hi', waMessageId = null, type = 'text', entryId = '10001', timestamp = '1730000000' } = {}) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: entryId,
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550123456', phone_number_id: phoneNumberId },
            contacts: [{ profile: { name: 'Cust' }, wa_id: number.replace(/\D/g, '') }],
            messages: [
              type === 'text'
                ? { from: number, id: waMessageId || inboundWamid(), timestamp, type: 'text', text: { body: text } }
                : { from: number, id: waMessageId || inboundWamid(), timestamp, type, image: { id: '98765', mime_type: 'image/jpeg', sha256: 'abc', caption: 'look' } },
            ],
          },
          field: 'messages',
        },
      ],
    },
  ],
});

const singleStatusEnvelope = (phoneNumberId, { waid, status, recipientId = '15550123456', error = null, entryId = '20001' } = {}) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: entryId,
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550123456', phone_number_id: phoneNumberId },
            statuses: [
              { id: waid, recipient_id: recipientId, status, timestamp: '1730000010',
                ...(error ? { errors: [{ code: 131026, title: 'Message undeliverable', message: 'Re-engagement message', details: 'RERUN' }] } : {}) },
            ],
          },
          field: 'messages',
        },
      ],
    },
  ],
});

// Fixtures
let businessA;
let businessB;
let agentAId;
const PHONE_A = '17000000000001';
const PHONE_B = '17000000000002';

test('setup: register two tenants + agents + channel configs (distinct Meta phone number ids)', async () => {
  businessA = (await register({ email: 'mu@phase13d.test', password: 'password123', name: 'Mu Owner', businessName: 'Mu Studio' })).body;
  assert.ok(businessA.token);
  businessB = (await register({ email: 'nu@phase13d.test', password: 'password123', name: 'Nu Owner', businessName: 'Nu Lab' })).body;
  assert.ok(businessB.token);

  agentAId = (await request('/v1/agents', {
    method: 'POST',
    token: businessA.token,
    body: { name: 'Mu Bot', industry: 'Services', voice: 'casual' },
  })).body.agent.id;
  assert.ok(agentAId);

  // Business B also needs an active agent so its own inbound can be answered.
  const agentB = (await request('/v1/agents', {
    method: 'POST',
    token: businessB.token,
    body: { name: 'Nu Bot', industry: 'Services', voice: 'casual' },
  })).body.agent;
  assert.ok(agentB.id);

  // Bind each tenant's WhatsApp channel to its own Meta phone number id. The
  // phone number id is a PUBLIC identifier (never a secret); numeric-only.
  const k = (business) => request('/v1/business/channels/whatsapp', {
    method: 'PUT',
    token: business.token,
    body: { enabled: true, displayName: 'WhatsApp Business', phoneNumberId: business === businessA ? PHONE_A : PHONE_B, providerBusinessAccountId: '200000000000002' },
  });
  assert.equal((await k(businessA)).status, 200);
  assert.equal((await k(businessB)).status, 200);

  // Non-numeric Meta ids are rejected.
  const bad = await request('/v1/business/channels/whatsapp', {
    method: 'PUT',
    token: businessA.token,
    body: { phoneNumberId: 'not-a-number' },
  });
  assert.equal(bad.status, 400);
});

test('channel binding: a phone number id already bound to another tenant is a clean 409', async () => {
  // business A tries to claim business B's already-bound Meta number.
  const steal = await request('/v1/business/channels/whatsapp', {
    method: 'PUT',
    token: businessA.token,
    body: { phoneNumberId: PHONE_B },
  });
  assert.equal(steal.status, 409);

  // business A's original binding is untouched.
  const list = await request('/v1/business/channels', { token: businessA.token });
  const whatsapp = list.body.channels.find((c) => c.channel === 'whatsapp');
  assert.equal(whatsapp.phoneNumberId, PHONE_A);
});

test('GET hub verification: correct token answers with the raw challenge', async () => {
  const ok = await request(`/v1/channel/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(process.env.WHATSAPP_VERIFY_TOKEN)}&hub.challenge=CHALLENGE_123`);
  assert.equal(ok.status, 200);
  assert.equal(ok.text, 'CHALLENGE_123');
  assert.ok(ok.body.raw === 'CHALLENGE_123' || ok.text === 'CHALLENGE_123');
});

test('GET hub verification: wrong token / wrong mode / missing challenge are rejected (403)', async () => {
  const wrong = await request(`/v1/channel/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=x`);
  assert.equal(wrong.status, 403);

  const badMode = await request(`/v1/channel/whatsapp/webhook?hub.mode=unsubscribe&hub.verify_token=${process.env.WHATSAPP_VERIFY_TOKEN}&hub.challenge=x`);
  assert.equal(badMode.status, 403);

  const noChallenge = await request(`/v1/channel/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${process.env.WHATSAPP_VERIFY_TOKEN}`);
  assert.equal(noChallenge.status, 403);
});

test('POST webhook: invalid signature is rejected 401 before anything is processed', async () => {
  const payload = messagesEnvelope(PHONE_A, { text: 'tampered' });
  const { headers } = signedEnvelope(payload, { secret: 'wrong-secret' });
  const res = await request('/v1/channel/whatsapp/webhook', {
    method: 'POST',
    rawBody: JSON.stringify(payload),
    headers,
  });
  assert.equal(res.status, 401);

  // Missing header
  const noHeader = await request('/v1/channel/whatsapp/webhook', { method: 'POST', rawBody: JSON.stringify(payload) });
  assert.equal(noHeader.status, 401);

  // Nothing may have been recorded.
  assert.equal((await waMessagesFor(businessA.business.id)).length, 0);
});

test('POST webhook: malformed payloads are rejected/acknowledged without state', async () => {
  // Not valid JSON at all (signed) -> 400 from the parser.
  const rawGarbage = '{this is not json';
  const sigGarbage = crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(rawGarbage).digest('hex');
  const garbage = await request('/v1/channel/whatsapp/webhook', {
    method: 'POST',
    rawBody: rawGarbage,
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${sigGarbage}` },
  });
  assert.equal(garbage.status, 400);

  // Signed JSON but without a signature header now -> 401 (rejected before parsing).
  const noHeader = await request('/v1/channel/whatsapp/webhook', {
    method: 'POST',
    rawBody: JSON.stringify({ grape: 'feldspar' }),
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(noHeader.status, 401);

  // Valid signature, structurally not a Meta envelope -> acknowledged, nothing happens.
  const empty = await webhook({ grape: 'feldspar' });
  assert.equal(empty.status, 200);
  assert.equal(empty.body.processed, 0);
  assert.equal((await waMessagesFor(businessA.business.id)).length, 0);
});

test('inbound text: signature verified, engine fed through the SAME engine, real outbound, ledger both sides', async () => {
  const waId = inboundWamid();
  const res = await webhook(messagesEnvelope(PHONE_A, { text: 'I want to book a session', waMessageId: waId }));
  assert.equal(res.status, 200);
  assert.equal(res.body.received, true);
  assert.equal(res.body.processed, 1);

  const rows = await waMessagesFor(businessA.business.id);
  assert.equal(rows.length, 2, 'one inbound + one outbound ledger row');
  const inbound = rows.find((r) => r.direction === 'inbound');
  const outbound = rows.find((r) => r.direction === 'outbound');
  assert.equal(inbound.wa_message_id, waId);
  assert.equal(inbound.status, 'received');
  assert.equal(inbound.message_type, 'text');
  assert.equal(inbound.customer_phone, '+2348010000001');
  assert.equal(outbound.status, 'sent', 'sent only after Meta accepted it');
  assert.ok(outbound.wa_message_id.startsWith('wamid.out.'));
  assert.equal(outbound.body, 'Mock reply to: I want to book a session');

  // The adapter got the exact Meta payload contract, server-side token, no secrets in the url.
  const call = capturedTransports[capturedTransports.length - 1];
  assert.ok(call.url.endsWith(`/${PHONE_A}/messages`));
  assert.equal(call.accessToken, process.env.WHATSAPP_ACCESS_TOKEN);
  assert.equal(call.payload.messaging_product, 'whatsapp');
  assert.equal(call.payload.recipient_type, 'individual');
  assert.equal(call.payload.to, '+2348010000001');
  assert.equal(call.payload.type, 'text');
  assert.equal(call.payload.text.body, 'Mock reply to: I want to book a session');

  // The tenant conversation is whatsapp-tagged with no touchpoint.
  const convs = await conversationsFor(businessA.business.id);
  assert.equal(convs.length, 1);
  assert.equal(convs[0].channel, 'whatsapp');
  assert.equal(convs[0].touchpoint_id, null);

  const msgs = await userMessagesFor(convs[0].id);
  assert.deepEqual(msgs.map((m) => [m.role, m.text]), [
    ['user', 'I want to book a session'],
    ['assistant', 'Mock reply to: I want to book a session'],
  ]);
});

test('idempotency: duplicate message id and duplicate webhook delivery never reprocess', async () => {
  const before = await waMessagesFor(businessA.business.id);
  const waId = inboundWamid();
  // A fresh sender so the conversation is newly created by this delivery.
  const env = messagesEnvelope(PHONE_A, { text: 'dup me', waMessageId: waId, number: '+2348033333333' });

  assert.equal((await webhook(env)).status, 200);
  const afterFirst = await waMessagesFor(businessA.business.id);
  assert.equal(afterFirst.length, before.length + 2, 'one fresh inbound + outbound');
  const inbound = afterFirst.find((r) => r.wa_message_id === waId);
  assert.ok(inbound);

  // Redeliver the exact same envelope (e.g. Meta retry after our 200 race).
  assert.equal((await webhook(env)).status, 200);
  const afterSecond = await waMessagesFor(businessA.business.id);
  assert.equal(afterSecond.length, afterFirst.length, 'no new ledger rows');

  // And deliver the same message id with a different envelope — still deduped.
  const env2 = messagesEnvelope(PHONE_A, { text: 'dup me', waMessageId: waId, entryId: '99999', number: '+2348033333333' });
  assert.equal((await webhook(env2)).status, 200);
  const afterThird = await waMessagesFor(businessA.business.id);
  assert.equal(afterThird.length, afterFirst.length, 'message-id idempotency holds across envelopes');

  const msgs = await userMessagesFor(inbound.conversation_id);
  assert.equal(msgs.length, 2, 'engine ran exactly once for this message id');
});

test('unresolvable phone number id: acked silently, zero state (no existence oracle)', async () => {
  const beforeConvs = await conversationsFor(businessA.business.id);
  const res = await webhook(messagesEnvelope('19999999999999', { text: 'ghost number' }));
  assert.equal(res.status, 200);
  assert.equal(res.body.processed, 0);
  const afterConvs = await conversationsFor(businessA.business.id);
  assert.equal(afterConvs.length, beforeConvs.length, 'no conversation created for unknown number');
});

test('tenant isolation: a sender on business A number routes ONLY to business A, never B', async () => {
  const aConvsBefore = (await conversationsFor(businessA.business.id)).length;
  const bConvsBefore = (await conversationsFor(businessB.business.id)).length;

  const res = await webhook(messagesEnvelope(PHONE_A, { text: 'hello A', number: '+2348111111111' }));
  assert.equal(res.status, 200);
  assert.equal(res.body.processed, 1);

  const aRows = await waMessagesFor(businessA.business.id);
  const bRows = await waMessagesFor(businessB.business.id);
  assert.ok(aRows.some((r) => r.customer_phone === '+2348111111111'), 'ledger row lands on business A');
  assert.equal(bRows.length, 0, 'business B touched nothing');
  assert.equal((await conversationsFor(businessA.business.id)).length, aConvsBefore + 1);
  assert.equal((await conversationsFor(businessB.business.id)).length, bConvsBefore, 'no conversation under B');

  // Now a message on business B's number must land on B, and its conversation
  // must be entirely separate (per-sender identity too).
  await webhook(messagesEnvelope(PHONE_B, { text: 'hello B', number: '+2348222222222' }));
  const bAfter = await waMessagesFor(businessB.business.id);
  assert.ok(bAfter.some((r) => r.customer_phone === '+2348222222222' && r.direction === 'inbound'));
  const bConvs = await conversationsFor(businessB.business.id);
  assert.equal(bConvs.length, bConvsBefore + 1);
  const idsA = new Set((await conversationsFor(businessA.business.id)).map((c) => c.id));
  assert.ok(!idsA.has(bConvs[bConvs.length - 1].id), 'conversation ids never shared across tenants');
});

test('media-safety: non-text messages are persisted with metadata but never answered', async () => {
  const beforeRows = await waMessagesFor(businessA.business.id);
  const waId = inboundWamid();
  const res = await webhook(messagesEnvelope(PHONE_A, { type: 'image', waMessageId: waId }));
  assert.equal(res.status, 200);
  assert.equal(res.body.processed, 1);

  const after = await waMessagesFor(businessA.business.id);
  assert.equal(after.length, beforeRows.length + 1, 'media is persisted, not dropped');
  const row = after.find((r) => r.wa_message_id === waId);
  assert.equal(row.status, 'received');
  assert.equal(row.message_type, 'image');
  assert.deepEqual(row.media, { attachment: 'image', id: '98765', mimeType: 'image/jpeg', caption: 'look' });
  assert.equal(row.body, null);
  assert.equal(after.filter((r) => r.direction === 'outbound').length, beforeRows.filter((r) => r.direction === 'outbound').length, 'no invented reply to media');
});

test('oversized text is stored for audit but not fed to the engine', async () => {
  const waId = inboundWamid();
  const big = 'x'.repeat(2500);
  const res = await webhook(messagesEnvelope(PHONE_A, { text: big, waMessageId: waId }));
  assert.equal(res.status, 200);
  const row = (await waMessagesFor(businessA.business.id)).find((r) => r.wa_message_id === waId);
  assert.ok(row);
  assert.equal(row.body, big);
  assert.ok(!row.conversation_id, 'oversized text never enters a conversation');
});

test('provider transient failure: bounded retries with backoff, then a failed ledger row, still acked', async () => {
  transportMode = 'retryable';
  transportCalls = 0;
  transportErrors = 0;
  const waId = inboundWamid();

  const res = await webhook(messagesEnvelope(PHONE_A, { text: 'will it deliver?', waMessageId: waId }));
  assert.equal(res.status, 200, 'a provider outage never becomes a 5xx to Meta');
  assert.equal(transportCalls, 3, 'exactly 1 initial + 2 bounded retries on a retryable failure');

  const outbound = await outboundReplyingTo(businessA.business.id, waId);
  assert.equal(outbound.status, 'failed', 'never claimed sent');
  assert.ok(
    outbound.provider_error.includes('network error or timeout'),
    `provider_error is sanitized + descriptive, got: ${outbound.provider_error}`
  );
  transportMode = 'ok';
});

test('provider permanent failure: no retry, failed ledger row, still acked', async () => {
  transportMode = 'permanent';
  transportCalls = 0;
  const waId = inboundWamid();

  const res = await webhook(messagesEnvelope(PHONE_A, { text: 'will it deliver?', waMessageId: waId }));
  assert.equal(res.status, 200);
  assert.equal(transportCalls, 1, 'permanent 4xx is never retried');

  const outbound = await outboundReplyingTo(businessA.business.id, waId);
  assert.equal(outbound.status, 'failed');
  assert.ok(outbound.provider_error.includes('HTTP 400'));
  transportMode = 'ok';
});

test('status callbacks: sent -> delivered -> read on the right tenant; failed is final; unknowns ignored', async () => {
  // Produce an outbound row for business A.
  const waId = inboundWamid();
  await webhook(messagesEnvelope(PHONE_A, { text: 'status me', waMessageId: waId }));
  const outbound = await outboundReplyingTo(businessA.business.id, waId);
  assert.ok(outbound, 'an outbound reply was produced');
  const wamid = outbound.wa_message_id;
  assert.ok(wamid, 'provider wamid recorded for status callback correlation');

  const deliver = await webhook(singleStatusEnvelope(PHONE_A, { waid: wamid, status: 'delivered' }));
  assert.equal(deliver.status, 200);
  let row = (await waMessagesFor(businessA.business.id)).find((r) => r.wa_message_id === wamid);
  assert.equal(row.status, 'delivered');

  const read = await webhook(singleStatusEnvelope(PHONE_A, { waid: wamid, status: 'read' }));
  assert.equal(read.status, 200);
  row = (await waMessagesFor(businessA.business.id)).find((r) => r.wa_message_id === wamid);
  assert.equal(row.status, 'read');

  // Status must never regress.
  const lateSent = await webhook(singleStatusEnvelope(PHONE_A, { waid: wamid, status: 'sent' }));
  assert.equal(lateSent.status, 200);
  row = (await waMessagesFor(businessA.business.id)).find((r) => r.wa_message_id === wamid);
  assert.equal(row.status, 'read', 'delivered/read never roll back');

  // Failed is final and records the provider error.
  const failed = await webhook(singleStatusEnvelope(PHONE_A, { waid: wamid, status: 'failed', error: true }));
  assert.equal(failed.status, 200);
  row = (await waMessagesFor(businessA.business.id)).find((r) => r.wa_message_id === wamid);
  assert.equal(row.status, 'failed');
  assert.ok((row.provider_error || '').includes('131026'));

  // Unknown status ids are ignored (no existence oracle), and a status aimed at
  // business B's outbound can never touch business A's row.
  const ghost = await webhook(singleStatusEnvelope(PHONE_A, { waid: 'wamid.ghost.1', status: 'delivered' }));
  assert.equal(ghost.status, 200);
  const crossTenant = await webhook(singleStatusEnvelope(PHONE_B, { waid: wamid, status: 'delivered' }));
  assert.equal(crossTenant.status, 200);
  row = (await waMessagesFor(businessA.business.id)).find((r) => r.wa_message_id === wamid);
  assert.equal(row.status, 'failed', 'cross-tenant status never mutates the row');
});

test('webhook event ledger records message + status events once', async () => {
  const res = await testPool.query(
    "SELECT event_id FROM webhook_events WHERE event_type LIKE 'whatsapp%' ORDER BY event_id LIMIT 200"
  );
  const ids = res.rows.map((r) => r.event_id);
  assert.ok(ids.some((id) => id.includes('whatsapp:msg:')), 'message events recorded');
  assert.ok(ids.some((id) => id.startsWith('whatsapp:status:')), 'status events recorded');
  const duplicates = ids.length - new Set(ids).size;
  assert.equal(duplicates, 0, 'webhook-event ledger stays unique');
});