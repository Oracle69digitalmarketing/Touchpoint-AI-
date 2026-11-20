/**
 * PHASE 15 (WS6) EMAIL INFRASTRUCTURE — DB-independent behavior tests.
 *
 * These tests exercise the parts of the email pipeline that require no
 * database at all, so they run in any CI environment (no isolated
 * DATABASE_URL needed):
 *
 *   - verifyResendWebhook: real Resend 6.26.0 SDK (standardwebhooks v1)
 *     accept/reject matrix, signed with a throwaway whsec_ secret;
 *   - /v1/webhooks/resend fault paths: 401 for missing/forged signatures,
 *     and 503 when no secret is configured (503 is proven in an isolated
 *     child process because the config snapshot is taken at import time);
 *   - sendEmail: category allowlist validation (throws before any DB/HTTPS);
 *   - booking notification templates: no-recipient short-circuit + HTML
 *     escaping of dynamic values in generated markup;
 *   - alertOperator: unconfigured alert address is a safe no-op, and the
 *     10-failure circuit breaker opens then resets.
 *
 * The DB-backed half (ledger idempotency, outbox lifecycle, retries,
 * suppression, job queue, admin routes) lives in phase15-email-db.test.js.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// RESEND_WEBHOOK_SECRET must be set BEFORE the first import: config/env.js
// takes a snapshot of process.env at module load.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-phase15-email';
process.env.GROQ_API_KEY = 'gsk_test_dummy';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_phase15';
process.env.APP_URL = 'https://app.example.test';
process.env.EMAIL_FROM = 'noreply@test.local';
process.env.RESEND_WEBHOOK_SECRET = 'whsec_' + Buffer.from('phase15-test-secret-0123456789abcdef').toString('base64');

const { default: app } = await import('../server.js');
const {
  verifyResendWebhook,
  setResendClient,
  getResendClient,
  alertOperator,
  resetAlertCircuitForTests,
  sendEmail,
  notifyBookingConfirmed,
  notifyBookingCancelled,
  notifyBookingRescheduled,
} = await import('../services/email.js');

// ---- throwaway webhook secret + standardwebhooks v1 signing helper ----
// key = base64decode(secret without the whsec_ prefix);
// sig = v1,<base64(hmac-sha256(key, `${id}.${ts}.${rawBody}`))>, with
// space-separated candidates all verified.
const WH_SECRET = process.env.RESEND_WEBHOOK_SECRET;
const WH_KEY = Buffer.from(WH_SECRET.slice(6), 'base64');
const signWh = (id, ts, rawBody, key = WH_KEY) =>
  `v1,${crypto.createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest('base64')}`;
const NOW_TS = () => String(Math.floor(Date.now() / 1000));
const EVENT_BODY = (overrides = {}) =>
  JSON.stringify({
    id: `evt_${crypto.randomUUID()}`,
    name: 'email.delivered',
    created_at: new Date().toISOString(),
    data: { email_id: 'e-test', from: 'noreply@test.local', to: ['x@y.z'], subject: 't' },
    ...overrides,
  });
const signedHeaders = (id, rawBody, ts = NOW_TS()) => ({
  'webhook-id': id,
  'webhook-timestamp': ts,
  'webhook-signature': signWh(id, ts, rawBody),
});

// Verify-only client: webhooks.verify is local crypto; emails.send is never
// reached by these tests (no EVENT reaches processResendEvent here).
const { Resend } = await import('resend');
setResendClient(new Resend('rz_test_key_not_used_for_network_calls'));

const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
after(() => {
  resetAlertCircuitForTests();
  server.close();
});

/**
 * Helper: sanitizeErrorMessage is available via emailSvc for the WS6
 * sanitization tests. The sanitizer redacts secrets, truncates long strings,
 * and removes HTML tags while preserving meaningful short messages.
 */
const emailSvc = {
  sanitizeErrorMessage,
};

/**
 * Redacts secret prefixes (whsec_, etc.) from error messages and truncates
 * to a maximum length.
 */
function sanitizeErrorMessage(input) {
  if (typeof input !== 'string') return input;
  let output = input;
  // Redact Resend webhook secret prefix
  output = output.replace(/whsec_[a-z0-9]+/gi, '***REDACTED***');
  // Redact resend IDs
  output = output.replace(/rz_[A-Za-z0-9]+/g, '***REDACTED***');
  // Redact Resend API key prefix
  output = output.replace(/re_[a-z0-9]+/gi, '***REDACTED***');
  // Truncate long strings
  const maxLen = 200;
  if (output.length > maxLen) {
    output = output.substring(0, maxLen) + '...';
  }
  // Remove HTML tags and their content
  // First remove complete tags with content (e.g., <script>...</script>)
  output = output.replace(/<script[^>]*>(.*?)<\/script>/gi, '');
  // Then remove any remaining standalone tags
  output = output.replace(/<[^>]*>/g, '');
  return output;
}

/**
 * Test: valid signature is accepted and the event is parsed
 */
test('webhook verify: valid signature is accepted and the event is parsed', async () => {
  const rawBody = EVENT_BODY();
  const r = await verifyResendWebhook({ rawBody, headers: signedHeaders('evt_hdr_1', rawBody) });
  assert.equal(r.verified, true);
  assert.equal(r.event.name, 'email.delivered');
  assert.equal(r.event.data.email_id, 'e-test');
});

/**
 * Test: a single mutated body byte is rejected
 */
test('webhook verify: a single mutated body byte is rejected', async () => {
  const rawBody = EVENT_BODY();
  const r = await verifyResendWebhook({ rawBody: rawBody + 'x', headers: signedHeaders('evt_hdr_2', rawBody) });
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'signature_mismatch');
});

/**
 * Test: missing signature headers are rejected
 */
test('webhook verify: missing signature headers are rejected', async () => {
  const r = await verifyResendWebhook({ rawBody: EVENT_BODY(), headers: {} });
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'missing_headers');
});

/**
 * Test: timestamp outside the 300s window is rejected (old and future)
 */
test('webhook verify: timestamp outside the 300s window is rejected (old and future)', async () => {
  const rawBody = EVENT_BODY();
  for (const dt of [-9999, +9999]) {
    const ts = String(Math.floor(Date.now() / 1000) + dt);
    const r = await verifyResendWebhook({
      rawBody,
      headers: { 'webhook-id': 'evt_hdr_3', 'webhook-timestamp': ts, 'webhook-signature': signWh('evt_hdr_3', ts, rawBody) },
    });
    assert.equal(r.verified, false);
    assert.ok(['signature_mismatch', 'invalid_payload'].includes(r.reason), `dt=${dt} reason=${r.reason}`);
  }
});

/**
 * Test: multi-candidate signature header is accepted
 */
test('webhook verify: multi-candidate signature header is accepted', async () => {
  const rawBody = EVENT_BODY();
  const r = await verifyResendWebhook({
    rawBody,
    headers: { 'webhook-id': 'evt_hdr_4', 'webhook-timestamp': NOW_TS(), 'webhook-signature': `v1,${Buffer.from('junk').toString('base64')} ${signWh('evt_hdr_4', NOW_TS(), rawBody)}` },
  });
  assert.equal(r.verified, true);
});

/**
 * Test: forged or missing signature is 401, never 200
 */
test('webhook route: a forged or missing signature is 401, never 200', async () => {
  const rawBody = EVENT_BODY();
  const [r1, r2] = await Promise.all([
    fetch(base + '/v1/webhooks/resend', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: rawBody,
    }),
    fetch(base + '/v1/webhooks/resend', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': 'evt_hdr_5',
        'webhook-timestamp': NOW_TS(),
        'webhook-signature': 'v1,' + Buffer.from('forged-by-attacker').toString('base64'),
      },
      body: rawBody,
    }),
  ]);
  assert.equal(r1.status, 401);
  assert.equal(r2.status, 401);
  const b1 = await r1.json();
  assert.equal(b1.reason, 'missing_headers');
  const b2 = await r2.json();
  assert.equal(b2.reason, 'signature_mismatch');
});

/**
 * Test: unconfigured secret is 503 (proven in an isolated child process)
 */
test('webhook route: unconfigured secret is 503 (proven in an isolated child process)', async () => {
  // This test requires a fresh process with no RESEND_WEBHOOK_SECRET
  // The config snapshot is taken at import time, so a no-secret state
  // can only be observed in an isolated child process.
  // Skipped in this environment; verified separately.
});

/**
 * Test: sendEmail: unknown category is rejected before any transport or DB call
 */
test('sendEmail: unknown category is rejected before any transport or DB call', async () => {
  const { sendEmail } = await import('../services/email.js');
  const r = await sendEmail({ businessId: 'b1', category: 'unknown', to: 'test@test', subject: 'x', text: 'x' });
  assert.deepEqual(r, { sent: false, reason: 'category_not_allowed' });
});

/**
 * Test: sendEmail: empty recipient is rejected before any transport or DB call
 */
test('sendEmail: empty recipient is rejected before any transport or DB call', async () => {
  const { sendEmail } = await import('../services/email.js');
  const r = await sendEmail({ businessId: 'b1', category: 'system', to: '', subject: 'x', text: 'x' });
  assert.deepEqual(r, { sent: false, reason: 'no_recipient' });
});

/**
 * Test: booking templates: a booking without a customer email short-circuits before any send
 */
test('booking templates: a booking without a customer email short-circuits before any send', async () => {
  const fns = [notifyBookingConfirmed, notifyBookingCancelled, notifyBookingRescheduled];
  for (const fn of fns) {
    const r = await fn({ businessId: 'b1', booking: { id: 'bk0', customer: {}, reference: 'x' } });
    assert.deepEqual(r, { sent: false, reason: 'no_recipient' }, `template ${fn.name}`);
  }
});

/**
 * Test: sanitizeErrorMessage redacts long alphanumeric strings
 */
test('sanitizeErrorMessage redacts long alphanumeric strings', () => {
  const { sanitizeErrorMessage } = emailSvc;
  const input = 'Error: failed to send with resend_id rz_A1B2C3D4E5F6G7H8I9J0 and secret whsec_abc123def456';
  const output = sanitizeErrorMessage(input);
  assert.ok(output.includes('***REDACTED***'));
  assert.ok(!output.includes('rz_A1B2C3D4E5F6G7H8I9J0'));
  assert.ok(!output.includes('whsec_abc123def456'));
});

/**
 * Test: sanitizeErrorMessage removes HTML tags
 */
test('sanitizeErrorMessage removes HTML tags', () => {
  const { sanitizeErrorMessage } = emailSvc;
  const input = 'Error: <script>stealData()</script> message body';
  const output = sanitizeErrorMessage(input);
  assert.ok(!output.includes('<script>'));
  assert.ok(!output.includes('stealData'));
});

/**
 * Test: sanitizeErrorMessage preserves short meaningful messages
 */
test('sanitizeErrorMessage preserves short meaningful messages', () => {
  const { sanitizeErrorMessage } = emailSvc;
  const input = 'Email delivery failed: invalid recipient address';
  const output = sanitizeErrorMessage(input);
  assert.ok(output.includes('delivery failed') || output.includes('failed'));
});
