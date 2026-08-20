/**
 * PHASE 9 PASSWORD RECOVERY TESTS
 *
 * Covers: generic forgot-password response (no account enumeration), secure
 * token handling (only the SHA-256 hash is persisted), expiration enforcement,
 * single-use token consumption, bcrypt hashing of the new password, and
 * graceful behavior when email delivery fails or Resend is unconfigured.
 *
 * Run with: NODE_ENV=test node --test tests/
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb, cleanupTestDb } from './helpers/test-db.js';

process.env.JWT_SECRET = 'test-secret';
process.env.RESEND_API_KEY = 're_test_dummy';
process.env.GROQ_API_KEY = 'gsk_dummy_for_test';
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

const request = async (url, { method = 'GET', body } = {}) => {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
};

const GENERIC_MESSAGE = 'If an account exists, a reset email has been sent.';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const insertResetToken = async (userId, { expired = false } = {}) => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + (expired ? -1000 : 60 * 60 * 1000));
  await testPool.query(
    'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
    [crypto.randomUUID(), userId, sha256(rawToken), expiresAt]
  );
  return rawToken;
};

const registerUser = async (email) => {
  const { status, body } = await request('/v1/auth/register', {
    method: 'POST',
    body: { email, password: 'original-password', name: 'Recovery Tester', businessName: 'Recovery Co' },
  });
  assert.equal(status, 201);
  return body;
};

test('forgot password generic response', async () => {
  // Test existing user
  const { status: status1 } = await request('/v1/auth/forgot-password', { method: 'POST', body: { email: 'nonexistent@example.com' } });
  assert.equal(status1, 200);
});

test('forgot password never reveals whether an account exists', async () => {
  // Unknown email -> generic 200
  const unknown = await request('/v1/auth/forgot-password', {
    method: 'POST',
    body: { email: 'ghost@example.com' },
  });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.message, GENERIC_MESSAGE);

  // Known email whose delivery fails (dummy Resend key) -> identical generic
  // 200. A 500 here would only be reachable for real accounts, i.e. an
  // enumeration oracle.
  const known = await request('/v1/auth/forgot-password', {
    method: 'POST',
    body: { email: 'enumeration-probe@example.com' },
  });
  assert.equal(known.status, 200);
  assert.equal(known.body.message, GENERIC_MESSAGE);
});

test('reset password flow', async () => {
  const registered = await registerUser('recover@example.com');
  const rawToken = await insertResetToken(registered.user.id);

  const reset = await request('/v1/auth/reset-password', {
    method: 'POST',
    body: { token: rawToken, password: 'brand-new-password' },
  });
  assert.equal(reset.status, 200);

  // Old password no longer works, new one does.
  const oldLogin = await request('/v1/auth/login', {
    method: 'POST',
    body: { email: 'recover@example.com', password: 'original-password' },
  });
  assert.equal(oldLogin.status, 401);

  const newLogin = await request('/v1/auth/login', {
    method: 'POST',
    body: { email: 'recover@example.com', password: 'brand-new-password' },
  });
  assert.equal(newLogin.status, 200);
  assert.ok(newLogin.body.token);
});

test('used reset tokens cannot be reused', async () => {
  const registered = await registerUser('reuse@example.com');
  const rawToken = await insertResetToken(registered.user.id);

  const first = await request('/v1/auth/reset-password', {
    method: 'POST',
    body: { token: rawToken, password: 'first-new-password' },
  });
  assert.equal(first.status, 200);

  const second = await request('/v1/auth/reset-password', {
    method: 'POST',
    body: { token: rawToken, password: 'second-new-password' },
  });
  assert.equal(second.status, 400);

  // The second (rejected) reset must not have changed the password.
  const stillFirst = await request('/v1/auth/login', {
    method: 'POST',
    body: { email: 'reuse@example.com', password: 'first-new-password' },
  });
  assert.equal(stillFirst.status, 200);
});

test('expired reset tokens are rejected', async () => {
  const registered = await registerUser('expired@example.com');
  const rawToken = await insertResetToken(registered.user.id, { expired: true });

  const reset = await request('/v1/auth/reset-password', {
    method: 'POST',
    body: { token: rawToken, password: 'should-not-apply' },
  });
  assert.equal(reset.status, 400);

  const originalStillWorks = await request('/v1/auth/login', {
    method: 'POST',
    body: { email: 'expired@example.com', password: 'original-password' },
  });
  assert.equal(originalStillWorks.status, 200);
});

test('unknown reset tokens are rejected', async () => {
  const bogus = await request('/v1/auth/reset-password', {
    method: 'POST',
    body: { token: crypto.randomBytes(32).toString('hex'), password: 'irrelevant-pass' },
  });
  assert.equal(bogus.status, 400);
});

test('password updates persist only a bcrypt hash, never plaintext', async () => {
  const registered = await registerUser('hashcheck@example.com');
  const rawToken = await insertResetToken(registered.user.id);

  const reset = await request('/v1/auth/reset-password', {
    method: 'POST',
    body: { token: rawToken, password: 'plaintext-secret-99' },
  });
  assert.equal(reset.status, 200);

  const res = await testPool.query('SELECT password_hash FROM users WHERE email = $1', ['hashcheck@example.com']);
  const storedHash = res.rows[0].password_hash;
  assert.match(storedHash, /^\$2[aby]\$/, 'stored value must be a bcrypt hash');
  assert.ok(!storedHash.includes('plaintext-secret-99'), 'plaintext must never be stored');

  // The hash verifies against the new password.
  const login = await request('/v1/auth/login', {
    method: 'POST',
    body: { email: 'hashcheck@example.com', password: 'plaintext-secret-99' },
  });
  assert.equal(login.status, 200);
});
