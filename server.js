
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import Groq from 'groq-sdk';
import { Resend } from 'resend';
let resend = null;
try {
  if (config.resendApiKey) {
    resend = new Resend(config.resendApiKey);
  }
} catch (e) {
  console.error("Failed to initialize Resend:", e);
}

async function sendVerificationEmail(email, token) {
  const url = `${config.appUrl}/v1/auth/verify-email/${token}`;
  if (resend) {
    await resend.emails.send({
      from: config.emailFrom,
      to: email,
      subject: 'Verify your TouchPoint AI account',
      html: `<p>Please verify your email address by clicking the link below:</p>
             <p><a href="${url}">Verify Email</a></p>
             <p>This link expires in 24 hours.</p>`,
    });
  } else {
    console.warn('[Auth] Email sending skipped: no Resend API key');
  }
}
import { config, assertValidEnvironment, resolveTrustProxy } from './config/env.js';
import {
  pingDatabase,
  closeDatabase,
  pool,
  createBusiness,
  businessSlugExists,
  createUser,
  findUserByEmail,
  findUserById,
  createSession,
  findSession,
  revokeSession,
  createResetToken,
  findResetToken,
  consumeResetToken,
  invalidateUserTokens,
  updateUserPassword,
  saveCRMConnection,
  removeCRMConnection,
  listCRMConnections,
  createAgent,
  getAgentById,
  listAgents,
  countAgents,
  updateAgent,
  deleteAgent,
  createTouchpoint,
  getTouchpointById,
  getTouchpointByTrackingId,
  listTouchpoints,
  countTouchpoints,
  updateTouchpoint,
  deleteTouchpoint,
  trackingIdExists,
  recordScan,
  createConversation,
  getConversationById,
  addConversationMessage,
  listConversationMessages,
  listConversations,
  getBusinessById,
  getLeadById,
  findLeadByConversation,
  listLeads,
  countLeads,
  createLead,
  updateLead,
  createLeadNotification,
  listLeadNotifications,
  countUnreadLeadNotifications,
  markLeadNotificationsRead,
  countAnalyticsRows,
  analyticsBucketCounts,
  analyticsGroupedCounts,
  toSqlDateTime,
  getSubscription,
  resolveSubscription,
  upsertSubscription,
  findSubscriptionBySubscriptionCode,
  findSubscriptionByCustomerCode,
  createPaystackTransaction,
  getPaystackTransaction,
  setPaystackTransactionFinalStatus,
  hasWebhookEvent,
  recordWebhookEvent,
} from './db-pg.js';
import { PLAN_LIMITS } from './plan-limits.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fail fast before anything else runs: in production this rejects a
// deployment that is missing a required secret or misconfigured (see
// config/env.js). In development/test only JWT_SECRET is mandatory.
assertValidEnvironment(process.env);

const app = express();
const PORT = config.port;
const isTest = config.isTest;

/**
 * AUTH CONFIGURATION (server-side only)
 */
const JWT_SECRET = config.jwtSecret;
if (!JWT_SECRET) {
  throw new Error(
    'JWT_SECRET environment variable is required. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
  );
}

const SESSION_TTL_DAYS = config.sessionTtlDays;
const SESSION_TTL_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60;

// Public base URL used to build touchpoint destination links (e.g. QR targets).
// The /t/:trackingId route itself belongs to Phase 4; this only generates the
// correct future destination.
const APP_URL = config.appUrl;

const BCRYPT_ROUNDS = 10;
// A fixed hash used to equalize login timing when the email does not exist,
// so attackers cannot tell valid emails apart by response time.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_ROUNDS);

let groqClient = new Groq({ 
  apiKey: config.groqApiKey 
});

/**
 * TEST SEAM: lets the test suite substitute a fake Groq client so public
 * chat coverage does not depend on a live API key. Production always uses
 * the real client created above.
 */
export function _setGroqClient(client) {
  groqClient = client;
}

const PAYSTACK_SECRET = config.paystackSecretKey;

/**
 * PAYSTACK CLIENT (server-side only)
 *
 * Every Paystack call for billing runs through this object with the SECRET key;
 * the public key only ever lives in the browser for the checkout widget. The
 * client is a test seam: `_setPaystackClient` lets the test suite substitute a
 * deterministic fake so billing coverage does not depend on a live account.
 */
const PAYSTACK_API_BASE = 'https://api.paystack.co';
const paystackAuthHeaders = () => ({ Authorization: `Bearer ${PAYSTACK_SECRET}` });

let paystackClient = {
  async initialize({ amount, email, currency, reference, planCode, callbackUrl, metadata }) {
    const response = await axios.post(`${PAYSTACK_API_BASE}/transaction/initialize`, {
      amount,
      email,
      currency,
      reference,
      ...(planCode ? { plan: planCode } : {}),
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
      metadata,
    }, { headers: paystackAuthHeaders() });
    return response.data;
  },
  async verify(reference) {
    const response = await axios.get(
      `${PAYSTACK_API_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: paystackAuthHeaders() },
    );
    return response.data;
  },
  async createCustomer({ email, metadata }) {
    const response = await axios.post(`${PAYSTACK_API_BASE}/customer`, { email, metadata }, {
      headers: paystackAuthHeaders(),
    });
    return response.data;
  },
  async disableSubscription({ code, token }) {
    const response = await axios.post(`${PAYSTACK_API_BASE}/subscription/disable`, { code, token }, {
      headers: paystackAuthHeaders(),
    });
    return response.data;
  },
};

export function _setPaystackClient(client) {
  paystackClient = client;
}

/**
 * SECURITY MIDDLEWARE
 */

app.disable('x-powered-by');

app.use(helmet({
  // CSP is disabled for now: the current UI loads inline scripts (Tailwind CDN,
  // importmap), CDN modules (esm.sh) and the Paystack inline checkout. A strict
  // CSP must be validated end-to-end before it is enabled.
  contentSecurityPolicy: false,
  // Keep window.opener working so Paystack's popup checkout is not broken.
  crossOriginOpenerPolicy: { policy: 'unsafe-none' },
  // Privacy: keep the referrer off cross-origin navigations (helmet default).
  referrerPolicy: { policy: 'no-referrer' },
}));

// Permissions-Policy is not part of helmet; set it manually to disable
// features the SPA never uses (camera, microphone, geolocation).
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Behind a reverse proxy (nginx, Caddy, a PAAS load balancer) the real client
// IP arrives via X-Forwarded-For, and express-rate-limit refuses to run when
// that header is present while `trust proxy` is disabled
// (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR). `resolveTrustProxy` produces a hop
// count (never the permissive `true`), defaulting to one trusted hop in
// production — Render's documented layout — while an explicit TRUST_PROXY
// (including TRUST_PROXY=0 to opt out) always wins. In non-production modes
// nothing is trusted unless TRUST_PROXY is set, so a client cannot forge the
// header to defeat the per-IP rate limiters.
const trustProxy = resolveTrustProxy(process.env);
if (trustProxy !== false) {
  app.set('trust proxy', trustProxy);
}

const CORS_ORIGINS = config.corsOrigins;

app.use(cors({
  origin(origin, callback) {
    // Requests without an Origin header (curl, same-origin in production) are allowed.
    if (!origin || CORS_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    const err = new Error('Not allowed by CORS');
    err.status = 403;
    return callback(err);
  },
  credentials: true,
}));

// Paystack webhook signatures are computed over the exact raw request body
// bytes, so the raw buffer is captured before any parsing for every request.
const rawBodyCapture = (req, res, buf) => {
  req.rawBody = buf;
};

app.use(bodyParser.json({ limit: '100kb', verify: rawBodyCapture }));
app.use(bodyParser.urlencoded({ extended: true, limit: '100kb', verify: rawBodyCapture }));

// General API rate limit. /v1/health is exempted so deployment health checks
// (Render checks this every few seconds) can never be throttled into a false
// "unhealthy" restart loop. When mounted at /v1 the health route appears as
// req.path === '/health' (req.originalUrl === '/v1/health').
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => req.originalUrl === '/v1/health' || req.path === '/health',
});

// Stricter rate limit for AI endpoints (each call consumes Groq quota)
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI requests, please slow down.' },
});

// Stricter rate limit for authentication endpoints (brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later.' },
});

// Per-IP limit for the public touchpoint chat. The endpoints under /v1/t are
// unauthenticated and consume Groq quota, so they need a tighter ceiling than
// the general API limiter. Guests are expected to take many seconds between
// messages, so 30/min will never throttle a real conversation.
const publicChatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many chat requests, please slow down.' },
});

// Rate limits are skipped during automated tests to keep them deterministic.
if (!isTest) {
  app.use('/v1', apiLimiter);
  app.use('/v1/ai', aiLimiter);
  app.use('/v1/t', publicChatLimiter);
  // Brute-force protection targets only credential endpoints.
  app.use('/v1/auth/login', authLimiter);
  app.use('/v1/auth/register', authLimiter);
}

// The public touchpoint page is only ever rendered through /t/:trackingId
// (which injects the resolved payload). Its raw template must not be
// reachable directly, so it is blocked before the static middleware.
app.use('/t.html', (req, res) => {
  res.status(404).type('html').send('Not found');
});

// Serve static files from the Vite build directory. The hashed asset files
// (JS/CSS/fonts) are content-addressed and can be cached immutably; the HTML
// entry points must never be cached so the latest build and injected payloads
// are always served.
app.use(express.static(path.join(__dirname, 'dist'), {
  setHeaders(res, filePath) {
    const base = path.basename(filePath);
    if (base === 'index.html' || base === 't.html') {
      res.setHeader('Cache-Control', 'no-store');
    } else if (/\.(js|css|png|jpe?g|gif|svg|webp|woff2?|ttf|eot)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));

// Wraps async route handlers so unexpected errors reach the central handler.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * AUTH HELPERS
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
});

const publicBusiness = (business) => ({
  id: business.id,
  name: business.name,
  slug: business.slug,
  plan: business.plan || 'Free',
  subscription: business.subscription ? {
    plan: business.subscription.plan,
    status: business.subscription.status,
    currentPeriodEnd: business.subscription.current_period_end,
  } : undefined,
});

async function signToken(user) {
  const sessionId = crypto.randomUUID();
  await createSession({
    id: sessionId,
    userId: user.id,
    businessId: user.business_id,
    ttlSeconds: SESSION_TTL_SECONDS,
  });
  const token = jwt.sign(
    { sub: user.id, sid: sessionId, bid: user.business_id },
    JWT_SECRET,
    { expiresIn: SESSION_TTL_SECONDS }
  );
  return token;
}

/**
 * Verifies the Bearer token, checks the server-side session is still active,
 * loads the user + their business, and attaches them to the request.
 * Rejects unauthenticated callers with 401 before any handler runs.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const session = await findSession(payload.sid);
  if (!session) {
    return res.status(401).json({ error: 'Session no longer active, please sign in again' });
  }

  const user = await findUserById(payload.sub);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  req.user = user;
  req.business = user.business;
  req.sessionId = session.id;
  return next();
}

/**
 * AUTH ENDPOINTS (/v1/auth)
 */

// Registration creates a new business workspace plus its owner user.
app.post('/v1/auth/register', asyncHandler(async (req, res) => {
  const { email, password, name, businessName } = req.body || {};

  const errors = {};
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    errors.email = 'A valid email address is required';
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    errors.password = 'Password must be between 8 and 128 characters';
  }
  if (typeof name !== 'string' || name.trim().length < 2) {
    errors.name = 'Your name is required';
  }
  if (typeof businessName !== 'string' || businessName.trim().length < 2) {
    errors.businessName = 'A business name is required';
  }
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ error: 'Validation failed', fields: errors });
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (await findUserByEmail(normalizedEmail)) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  // Build a unique URL-safe slug for the workspace.
  const baseSlug = businessName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'business';
  let slug = baseSlug;
  let suffix = 2;
  while (await businessSlugExists(slug)) {
    slug = `${baseSlug}-${suffix++}`;
  }

  const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  const business = await createBusiness(businessName.trim(), slug);
  const userId = crypto.randomUUID();
  const verificationToken = crypto.randomBytes(32).toString('hex');
  const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await createUser({
    id: userId,
    businessId: business.id,
    email: normalizedEmail,
    passwordHash,
    name: name.trim(),
    role: 'owner',
    emailVerified: config.isTest,
    verificationToken: config.isTest ? null : verificationToken,
    verificationExpiresAt: config.isTest ? null : verificationExpiresAt,
  });

  if (config.isTest) {
    const token = await signToken({ id: userId, business_id: business.id });
    return res.status(201).json({
      token,
      user: publicUser({ id: userId, email: normalizedEmail, name: name.trim(), role: 'owner' }),
      business: publicBusiness(business),
    });
  }

  try {
    await sendVerificationEmail(normalizedEmail, verificationToken);
  } catch (error) {
    console.error('[Auth] Failed to send verification email for', normalizedEmail, ':', error.message);
    return res.status(500).json({ error: 'Account created, but verification email failed to send. Please contact support.' });
  }

  return res.status(201).json({ message: 'User registered, check email to verify' });
}));

app.get('/v1/auth/verify-email/:token', asyncHandler(async (req, res) => {
  const { token } = req.params;
  const user = await pool.query('SELECT id FROM users WHERE verification_token = $1 AND verification_expires_at > CURRENT_TIMESTAMP', [token]);
  
  if (user.rowCount === 0) {
    return res.status(400).json({ error: 'Invalid or expired verification token' });
  }

  await pool.query('UPDATE users SET email_verified = TRUE, verification_token = NULL, verification_expires_at = NULL WHERE id = $1', [user.rows[0].id]);
  return res.json({ message: 'Email verified successfully' });
}));

app.post('/v1/auth/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = await findUserByEmail(normalizedEmail);

  // Compare against a dummy hash when the user is unknown so the response
  // timing stays consistent and does not reveal whether the email exists.
  const passwordOk = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_PASSWORD_HASH);

  if (!user || !passwordOk) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (!config.isTest && !user.email_verified) {
    return res.status(403).json({ error: 'Please verify your email address before logging in' });
  }

  const token = await signToken(user);

  return res.json({
    token,
    user: publicUser(user),
    business: publicBusiness(user.business),
  });
}));

app.get('/v1/auth/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({
    user: publicUser(req.user),
    business: publicBusiness(req.business),
  });
}));

app.post('/v1/auth/logout', requireAuth, asyncHandler(async (req, res) => {
  await revokeSession(req.sessionId);
  res.json({ message: 'Logged out successfully' });
}));


/**
 * PASSWORD RESET ENDPOINTS (/v1/auth)
 */

app.post('/v1/auth/forgot-password', asyncHandler(async (req, res) => {
  const { email } = req.body || {};
  if (!email || !EMAIL_RE.test(email.trim())) {
    return res.status(200).json({ message: 'If an account exists, a reset email has been sent.' });
  }
  const normalizedEmail = email.trim().toLowerCase();
  const user = await findUserByEmail(normalizedEmail);

  if (user) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await invalidateUserTokens(user.id);
    await createResetToken({ userId: user.id, tokenHash, expiresAt });

    const resetUrl = `${APP_URL}/reset-password?token=${rawToken}`;
    await resend.emails.send({
      from: config.emailFrom,
      to: user.email,
      subject: 'Reset your TouchPoint AI password',
      html: `<p>You requested a password reset. Click the link below to set a new password:</p>
             <p><a href="${resetUrl}">Reset Password</a></p>
             <p>This link expires in 1 hour.</p>`,
    });
  }

  res.status(200).json({ message: 'If an account exists, a reset email has been sent.' });
}));

app.post('/v1/auth/reset-password', asyncHandler(async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password || password.length < 8) {
    return res.status(400).json({ error: 'Invalid token or password' });
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const resetToken = await findResetToken(tokenHash);

  if (!resetToken) {
    return res.status(400).json({ error: 'Invalid or expired token' });
  }

  const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  await updateUserPassword(resetToken.user_id, passwordHash);
  await consumeResetToken(resetToken.id);

  res.json({ message: 'Password updated successfully' });
}));


/**
 * BILLING (Phase 7) — server-authoritative Paystack subscriptions
 *
 * The plan the server enforces and the UI shows comes from the persisted
 * subscription row, never from the client. The client only ever receives a
 * Paystack access code / authorization URL; the amount, currency, reference,
 * plan and tenant are fixed server-side when the transaction is initialized.
 * Entitlement is granted only by the signed webhook (`charge.success`) or by
 * the server-side verification endpoint, both of which cross-check the charged
 * amount/currency/plan code against what the server recorded.
 */

const BILLABLE_PLANS = ['Starter', 'Growth', 'Business'];
const PAYSTACK_CURRENCIES = ['NGN', 'USD'];
const PAYSTACK_PLAN_CODE_ENV = {
  Starter: 'PAYSTACK_PLAN_CODE_STARTER',
  Growth: 'PAYSTACK_PLAN_CODE_GROWTH',
  Business: 'PAYSTACK_PLAN_CODE_BUSINESS',
};
// Subscription lifecycle events that deterministically change a tenant's state.
const SUBSCRIPTION_LIFECYCLE_EVENTS = ['subscription.create', 'subscription.disable', 'subscription.expired', 'subscription.not_renew'];
// Defensive: Paystack's documented failure signal is subscription.disable, but
// some environments surface failed/abandoned charges explicitly.
const CHARGE_FAILED_EVENTS = ['charge.failed', 'charge.abandoned'];

const nowPg = () => toSqlDateTime(new Date());

/**
 * Verifies a Paystack webhook signature: HMAC-SHA512 of the raw request body
 * signed with the Paystack secret, constant-time compared. Any mismatch rejects
 * the event before a single byte of it is trusted.
 */
function verifyPaystackSignature(rawBody, signature) {
  if (!rawBody || !Buffer.isBuffer(rawBody) || typeof signature !== 'string' || !signature) return false;
  const expected = crypto.createHmac('sha512', PAYSTACK_SECRET).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Public view of a tenant's subscription for the API. The effective plan/status
 * come from resolveSubscription (a cancelled subscription keeps its tier until
 * its period ends, an expired one is Free).
 */
async function getPublicSubscription(businessId) {
  const resolved = await resolveSubscription(await getSubscription(businessId));
  return {
    plan: resolved.plan,
    status: resolved.status,
    paystackCustomerCode: resolved.paystack_customer_code,
    paystackSubscriptionCode: resolved.paystack_subscription_code,
    paystackPlanCode: resolved.paystack_plan_code,
    currentPeriodStart: resolved.current_period_start,
    currentPeriodEnd: resolved.current_period_end,
    cancelledAt: resolved.cancelled_at,
    expiresAt: resolved.expires_at,
    lastReference: resolved.last_reference,
  };
}

async function ensurePaystackCustomer({ user, business }) {
  const current = await getSubscription(business.id);
  if (current.paystack_customer_code) return current.paystack_customer_code;

  const result = await paystackClient.createCustomer({
    email: user.email,
    metadata: { business_id: business.id },
  });
  const customerCode = result && result.data && result.data.customer_code;
  if (!customerCode) {
    throw Object.assign(new Error('Could not create Paystack customer'), { status: 502 });
  }
  await upsertSubscription(business.id, { paystackCustomerCode: customerCode });
  return customerCode;
}

async function cancelPaystackSubscription(businessId) {
  const current = await getSubscription(businessId);
  if (!current.paystack_subscription_code) return;
  try {
    await paystackClient.disableSubscription({
      code: current.paystack_subscription_code,
      token: current.paystack_email_token || '',
    });
  } catch (err) {
    // A failed disable must not block local cancellation: the Paystack
    // subscription.disable webhook reconciles state when it eventually arrives.
    console.error('[Billing] Paystack subscription disable failed:', err.message);
  }
}

/**
 * Applies a confirmed successful charge. Idempotent (a transaction is applied
 * at most once — terminal states are never rewritten). Every cross-check is
 * against server-recorded values, so a spoofed or mistyped event cannot grant
 * an entitlement the server did not intend.
 */
async function applySuccessfulCharge({ transaction, payload }) {
  const current = await getPaystackTransaction(transaction.reference);
  if (!current || current.status !== 'pending') return current;

  if (!current.plan_code) {
    // One-time charge: the charged amount must match what the server recorded.
    if (typeof payload.amount === 'number' && payload.amount !== current.amount) {
      console.warn(`[Billing] Amount mismatch for ${current.reference}: got ${payload.amount}, expected ${current.amount}`);
      await setPaystackTransactionFinalStatus(current.reference, 'failed', { event: 'charge.success', error: 'amount_mismatch' });
      return null;
    }
  }
  if (typeof payload.currency === 'string' && payload.currency !== current.currency) {
    console.warn(`[Billing] Currency mismatch for ${current.reference}: got ${payload.currency}, expected ${current.currency}`);
    await setPaystackTransactionFinalStatus(current.reference, 'failed', { event: 'charge.success', error: 'currency_mismatch' });
    return null;
  }

  const eventPlanCode = payload.plan && payload.plan.plan_code;
  if (current.plan_code && eventPlanCode && eventPlanCode !== current.plan_code) {
    console.warn(`[Billing] Plan code mismatch for ${current.reference}`);
    await setPaystackTransactionFinalStatus(current.reference, 'failed', { event: 'charge.success', error: 'plan_code_mismatch' });
    return null;
  }

  const chargedAt = payload.paid_at || payload.created_at;
  const startDate = chargedAt ? new Date(chargedAt) : new Date();
  const periodStart = toSqlDateTime(startDate);
  const periodEnd = toSqlDateTime(new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000));

  const customerCode = payload.customer && payload.customer.customer_code;
  const subscriptionCode = payload.subscription && payload.subscription.subscription_code;

  await upsertSubscription(current.business_id, {
    plan: current.plan,
    status: 'active',
    paystackPlanCode: eventPlanCode || current.plan_code || undefined,
    paystackCustomerCode: customerCode || undefined,
    paystackSubscriptionCode: subscriptionCode || undefined,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    cancelledAt: null,
    expiresAt: null,
    lastReference: current.reference,
  });

  return await setPaystackTransactionFinalStatus(current.reference, 'success', { event: 'charge.success' });
}

async function markChargeFailed(reference, status, event, error) {
  const transaction = await getPaystackTransaction(reference);
  if (!transaction || transaction.status !== 'pending') return transaction;
  return await setPaystackTransactionFinalStatus(reference, status, { event, error });
}

/**
 * PAYSTACK WEBHOOK (public, signature-verified)
 *
 * Registered BEFORE the workspace auth gate on purpose: Paystack delivers this
 * without a user session. Authenticity comes from the HMAC signature, not an
 * account. Processing is synchronous and idempotent:
 *   - signature mismatch        -> 401, no state change;
 *   - duplicate event id        -> 200 ack, no re-processing;
 *   - unknown reference         -> 200 ack, never grants anything;
 *   - unknown event type        -> 200 ack, no state change;
 *   - charge.success            -> entitlement granted (after cross-checks);
 *   - subscription lifecycle    -> cancellation / expiry persisted.
 */
app.post('/v1/billing/webhook', asyncHandler(async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  if (!verifyPaystackSignature(req.rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const event = req.body || {};
  const eventType = typeof event.event === 'string' ? event.event : '';
  const eventId = typeof event.id === 'string' ? event.id : null;
  const data = event.data || {};

  if (eventId && await hasWebhookEvent(eventId)) {
    return res.json({ received: true, duplicate: true });
  }

  if (eventType === 'charge.success') {
    const reference = typeof data.reference === 'string' ? data.reference : '';
    const transaction = reference ? await getPaystackTransaction(reference) : null;
    if (!transaction) {
      await recordWebhookEvent({ eventId, eventType });
      return res.json({ received: true, ignored: 'unknown_reference' });
    }
    const metadataBusinessId = data.metadata && data.metadata.business_id;
    if (metadataBusinessId && metadataBusinessId !== transaction.business_id) {
      await recordWebhookEvent({ eventId, eventType });
      return res.json({ received: true, ignored: 'metadata_mismatch' });
    }
    await applySuccessfulCharge({ transaction, payload: data });
    await recordWebhookEvent({ eventId, eventType, businessId: transaction.business_id });
    return res.json({ received: true, subscription: await getPublicSubscription(transaction.business_id) });
  }

  if (CHARGE_FAILED_EVENTS.includes(eventType)) {
    const reference = typeof data.reference === 'string' ? data.reference : '';
    const transaction = reference ? await getPaystackTransaction(reference) : null;
    if (transaction) {
      await markChargeFailed(reference, eventType === 'charge.abandoned' ? 'abandoned' : 'failed', eventType);
    }
    await recordWebhookEvent({ eventId, eventType, businessId: transaction ? transaction.business_id : null });
    return res.json({ received: true });
  }

  if (SUBSCRIPTION_LIFECYCLE_EVENTS.includes(eventType)) {
    const subscriptionCode = data.subscription_code || (data.subscription && data.subscription.subscription_code) || null;
    const subscription = subscriptionCode ? await findSubscriptionBySubscriptionCode(subscriptionCode) : null;

    if (eventType === 'subscription.create') {
      const customerCode = data.customer && data.customer.customer_code;
      const planCode = data.plan && data.plan.plan_code;
      const emailToken = data.email_token || null;
      const byCustomer = customerCode ? await findSubscriptionByCustomerCode(customerCode) : null;
      if (byCustomer) {
        await upsertSubscription(byCustomer.business_id, {
          paystackSubscriptionCode: subscriptionCode || undefined,
          paystackPlanCode: planCode || undefined,
          paystackEmailToken: emailToken || undefined,
        });
        await recordWebhookEvent({ eventId, eventType, businessId: byCustomer.business_id });
        return res.json({ received: true });
      }
    } else if (subscription) {
      if (eventType === 'subscription.disable') {
        await upsertSubscription(subscription.business_id, { status: 'cancelled', cancelledAt: nowPg() });
      } else if (eventType === 'subscription.expired') {
        await upsertSubscription(subscription.business_id, { status: 'expired', expiresAt: nowPg() });
      } else if (eventType === 'subscription.not_renew') {
        await upsertSubscription(subscription.business_id, { status: 'not_renewing' });
      }
      await recordWebhookEvent({ eventId, eventType, businessId: subscription.business_id });
      return res.json({ received: true });
    }

    await recordWebhookEvent({ eventId, eventType, businessId: subscription ? subscription.business_id : null });
    return res.json({ received: true });
  }

  await recordWebhookEvent({ eventId, eventType });
  res.json({ received: true });
}));

/**
 * WORKSPACE AUTH GATE
 * Everything below is scoped to the authenticated business. Unauthenticated
 * callers are rejected before any workspace data is touched.
 */
app.use('/v1/ai', requireAuth);
app.use('/v1/identity', requireAuth);
app.use('/v1/crm', requireAuth);
app.use('/v1/agents', requireAuth);
app.use('/v1/touchpoints', requireAuth);
app.use('/v1/conversations', requireAuth);
app.use('/v1/leads', requireAuth);
app.use('/v1/analytics', requireAuth);
app.use('/v1/billing', requireAuth);

/**
 * AI HELPERS
 * Shared between the authenticated /v1/ai/chat endpoint and the public
 * /v1/t/:trackingId/messages endpoint so both drive the same Groq logic.
 */

function buildAgentSystemInstruction(agent, targetLanguage) {
  const docContext = agent.documents && agent.documents.length > 0
    ? `Intelligence extracted from uploaded business documents (${agent.documents.join(', ')}): Highly specific business context applied.`
    : '';

  return `
    You are ${agent.name}, an intelligent digital brand ambassador for a ${agent.industry} business.
    Your voice profile is strictly ${agent.voice}.

    CRITICAL: YOU MUST RESPOND ONLY IN THE LANGUAGE CODE: "${targetLanguage}".

    KNOWLEDGE BASE:
    - Primary Catalog: ${agent.catalog || 'General professional services'}
    - Specialized Intelligence: ${docContext || 'Standard business logic'}

    OBJECTIVE:
    Act as the physical-to-digital bridge. A customer just scanned a physical touchpoint and needs assistance.
    Qualify them as a lead and guide them towards a conversion (meeting, order, or proposal).
  `;
}

async function runAgentChat({ agent, history, userInput, targetLanguage }) {
  const messages = [
    { role: 'system', content: buildAgentSystemInstruction(agent, targetLanguage) },
    ...history.map(m => ({
      role: m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user',
      content: m.text,
    })),
    { role: 'user', content: userInput },
  ];

  const completion = await groqClient.chat.completions.create({
    messages,
    model: 'llama-3.3-70b-versatile',
    temperature: 0.7,
    max_tokens: 150,
  });

  return completion.choices[0]?.message?.content;
}

// Customer-facing fallback when the AI provider is unreachable or returns an
// empty reply. Deliberately generic and safe: it never exposes provider
// errors, stack traces, secrets, or internal implementation details. Full
// error detail is always logged server-side instead.
const AI_FALLBACK_REPLY = "Thanks for reaching out! I'm having a quick connectivity issue — I'll be right with you.";

/**
 * AI ENDPOINTS
 */

app.post('/v1/ai/chat', asyncHandler(async (req, res) => {
  const { agent, history, userInput, targetLanguage } = req.body;

  try {
    const text = await runAgentChat({
      agent,
      history: history || [],
      userInput,
      targetLanguage,
    });

    res.json({ text });
  } catch (error) {
    // Log the full detail server-side; the client only ever sees the safe,
    // graceful fallback message.
    console.error("Groq Error:", error);
    res.status(500).json({ error: AI_FALLBACK_REPLY });
  }
}));

app.post('/v1/ai/proposal', asyncHandler(async (req, res) => {
  const { agentName, context, targetLanguage } = req.body;
  
  try {
    const completion = await groqClient.chat.completions.create({
      messages: [
        { role: 'system', content: `You are a professional proposal generator. Output ONLY valid JSON.` },
        { role: 'user', content: `Context: ${context}. Language: ${targetLanguage}. Generate a proposal from ${agentName}.` }
      ],
      model: 'llama-3.3-70b-versatile',
      response_format: { type: "json_object" }
    });
    res.json(JSON.parse(completion.choices[0]?.message?.content || '{}'));
  } catch (error) {
    res.status(500).json({ error: "Proposal error" });
  }
}));

/**
 * LEAD CAPTURE (Phase 5)
 *
 * The AI only proposes the raw material: it reads a conversation transcript
 * and suggests name / phone / email / intent / a qualification score. Every
 * decision that matters is made deterministically on the server:
 *
 *   - field sanitization (length, characters, email/phone format),
 *   - score clamping to 0..100,
 *   - the final qualification status derived from the score,
 *   - tenant scoping and plan-limit enforcement,
 *   - persistence and one-shot in-app notifications.
 *
 * If Groq is unreachable or returns unusable JSON, the chat keeps working and
 * no lead is written — a transient extraction failure must never break a
 * customer conversation.
 */

const LEAD_STATUSES = ['qualified', 'unqualified', 'pending'];

const LEAD_EXTRACTION_PROMPT = `You are a lead qualification engine.
Read the conversation transcript between a business's agent and a customer.
Return ONLY a valid JSON object with exactly these fields:
{
  "name": string or null,
  "phone": string or null,
  "email": string or null,
  "intent": string or null,
  "qualificationScore": integer between 0 and 100
}
Do not invent contact details that are not in the conversation. If the
customer shared no contact information, return null for those fields.`;

/**
 * Score thresholds are the single deterministic source of truth for lead
 * qualification. The AI proposes a score; the server alone decides the label.
 */
function scoreToQualificationStatus(score) {
  if (score >= 60) return 'qualified';
  if (score >= 30) return 'pending';
  return 'unqualified';
}

const cleanString = (value, maxLength) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || null;
};

const cleanPhone = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 24);
  if (!trimmed) return null;
  // Loose international format: digits with optional +, spaces, parens, dashes.
  if (!/^\+?[0-9][0-9 ()-]{5,23}$/.test(trimmed)) return null;
  return trimmed;
};

const cleanEmail = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase().slice(0, 254);
  if (!EMAIL_RE.test(trimmed)) return null;
  return trimmed;
};

/**
 * Normalizes an AI-proposed extraction into a validated, deterministic lead.
 * Every value is re-sanitized server-side; garbage in produces null fields,
 * never unvalidated data in the database.
 */
function normalizeExtractedLead(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const qualificationScore = Number.isFinite(Number(raw.qualificationScore))
    ? Math.max(0, Math.min(100, Math.round(Number(raw.qualificationScore))))
    : 0;

  return {
    name: cleanString(raw.name, 120),
    phone: cleanPhone(raw.phone),
    email: cleanEmail(raw.email),
    intent: cleanString(raw.intent, 500),
    qualificationScore,
    qualificationStatus: scoreToQualificationStatus(qualificationScore),
  };
}

function parseExtractedLead(content) {
  if (typeof content !== 'string' || !content.trim()) return null;
  let raw;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    return null;
  }
  return normalizeExtractedLead(raw);
}

/**
 * Runs the same Groq infrastructure as the chat: one completion call over the
 * conversation transcript, asked for a strict JSON object. The caller decides
 * what happens to the result.
 */
async function runLeadExtraction({ history }) {
  const transcript = history
    .map((m) => `${m.role}: ${m.text}`)
    .join('\n')
    .slice(0, 12000);

  const completion = await groqClient.chat.completions.create({
    messages: [
      { role: 'system', content: LEAD_EXTRACTION_PROMPT },
      { role: 'user', content: `Conversation transcript:\n${transcript}\n\nExtract the lead as JSON.` },
    ],
    model: 'llama-3.3-70b-versatile',
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  return completion.choices[0]?.message?.content;
}

/**
 * Extracts a lead from a completed conversation exchange and persists it under
 * the conversation's business. Reuses the existing conversation (one lead per
 * conversation, updated on later messages rather than duplicated). Creates a
 * one-shot in-app notification when a lead first qualifies. Plan-limit
 * enforcement is server-side: when the tenant is at capacity, new leads are
 * dropped (never the customer conversation), and the exhaustion is logged.
 */
async function captureLeadFromConversation({ conversation, touchpoint, agent }) {
  const history = await listConversationMessages(conversation.id);
  if (history.length === 0) return null;

  const content = await runLeadExtraction({ history });
  const extracted = parseExtractedLead(content);
  if (!extracted) return null;

  const business = await getBusinessById(touchpoint.business_id);
  const plan = (business && business.plan) || 'Free';
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.Free;

  const existing = await findLeadByConversation(touchpoint.business_id, conversation.id);
  let lead;
  if (existing) {
    lead = await updateLead(touchpoint.business_id, existing.id, extracted);
  } else {
    if ((await countLeads(touchpoint.business_id)) >= limits.leads) {
      console.warn(
        `[Lead Capture] ${plan} plan lead limit (${limits.leads}) reached for business ${touchpoint.business_id}; skipping persistence`
      );
      return null;
    }
    lead = await createLead({
      businessId: touchpoint.business_id,
      touchpointId: touchpoint.id,
      conversationId: conversation.id,
      agentId: agent ? agent.id : null,
      ...extracted,
      source: 'auto',
    });
  }

  if (lead && lead.qualification_status === 'qualified' && !lead.notified) {
    await createLeadNotification({ businessId: touchpoint.business_id, leadId: lead.id });
  }
  return lead;
}

/**
 * IDENTITY MANAGEMENT (PAYSTACK)
 */

// Resolve Account Number
app.get('/v1/identity/resolve-account', asyncHandler(async (req, res) => {
  const { account_number, bank_code } = req.query;

  try {
    const response = await axios.get(`https://api.paystack.co/bank/resolve`, {
      params: { account_number, bank_code },
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || { error: "Identity resolution failed" });
  }
}));

// BVN Resolution
app.get('/v1/identity/resolve-bvn/:bvn', asyncHandler(async (req, res) => {
  try {
    const response = await axios.get(`https://api.paystack.co/bank/resolve_bvn/${req.params.bvn}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || { error: "BVN resolution failed" });
  }
}));

// Fetch Bank List
app.get('/v1/identity/banks', asyncHandler(async (req, res) => {
  try {
    const response = await axios.get(`https://api.paystack.co/bank`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "Could not fetch banks" });
  }
}));

/**
 * CRM ENDPOINTS (scoped to the authenticated business)
 */

// Health Check. Includes a live database round-trip so load balancers and
// deployment health checks can tell "process is up" from "app is usable".
app.get('/v1/health', asyncHandler(async (req, res) => {
  let database = 'ok';
  try {
    const ok = await pingDatabase();
    if (!ok) database = 'error';
  } catch (err) {
    database = 'error';
  }
  const healthy = database === 'ok';
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    database,
    timestamp: new Date().toISOString(),
  });
}));

// List the authenticated business's CRM connections
app.get('/v1/crm/connections', requireAuth, asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, connections: await listCRMConnections(req.business.id) });
}));

// Connect CRM
app.post('/v1/crm/connect', requireAuth, asyncHandler(async (req, res) => {
  const { providerId } = req.body;

  if (!providerId) {
    return res.status(400).json({ success: false, message: "Missing providerId" });
  }

  console.log(`[Backend] Processing connection for: ${providerId}`);

  try {
    // --- PRODUCTION LOGIC ---
    // This is where you would use your SECRET keys stored in environment variables.
    // Example: 
    // const clientSecret = process.env[`${providerId.toUpperCase()}_CLIENT_SECRET`];
    // const authResponse = await someCrmSdk.authenticate(clientSecret);

    // Simulate network delay to the 3rd party CRM
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Persist the connection in the database, owned by this business
    const syncTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    await saveCRMConnection(req.business.id, providerId, syncTime);

    res.status(200).json({
      success: true,
      provider: providerId,
      lastSync: `${syncTime} ago`
    });

  } catch (error) {
    console.error(`[CRM Error]`, error);
    res.status(500).json({ success: false, message: "Internal server error during handshake." });
  }
}));

// Disconnect CRM (only the owning business can disconnect)
app.delete('/v1/crm/disconnect/:providerId', requireAuth, asyncHandler(async (req, res) => {
  const { providerId } = req.params;

  if (await removeCRMConnection(req.business.id, providerId)) {
    console.log(`[Backend] Disconnected: ${providerId}`);
    return res.status(200).json({ success: true });
  }

  res.status(404).json({ success: false, message: "Provider not found" });
}));

/**
 * AGENTS & TOUCHPOINTS (Phase 3)
 *
 * Every handler derives the tenant from the authenticated session
 * (req.business.id). A business_id supplied by the client is never read —
 * it is impossible to create or read another business's records here.
 */

const AGENT_STATUSES = ['Training', 'Active', 'Inactive'];
const AGENT_VOICES = ['professional', 'casual', 'technical', 'enthusiastic'];
const SURFACE_TYPES = ['Business Card', 'Flyer', 'Poster', 'NFC Tag', 'Table Tent'];

const publicAgent = (agent) => ({
  id: agent.id,
  name: agent.name,
  status: agent.status,
  industry: agent.industry,
  voice: agent.voice,
  description: agent.description,
  serviceCatalog: agent.service_catalog,
  clientProfiles: agent.client_profiles,
  caseLibrary: agent.case_library,
  guidelines: agent.guidelines,
  documents: agent.documents,
  leadsGenerated: agent.leads_generated,
  conversionRate: agent.conversion_rate,
  createdAt: agent.created_at,
});

const publicTouchpoint = (tp) => ({
  id: tp.id,
  name: tp.name,
  type: tp.type,
  agentId: tp.agent_id,
  agentName: tp.agent_name,
  agentStatus: tp.agent_status,
  scans: tp.scans,
  active: tp.active,
  location: tp.location,
  trackingId: tp.tracking_id,
  url: `${APP_URL}/t/${tp.tracking_id}`,
  createdAt: tp.created_at,
});

/**
 * Collision-resistant, server-generated tracking id. 64 bits of entropy from
 * a CSPRNG UUID (the global crypto object is WebCrypto in ESM, so randomUUID
 * is used rather than node:crypto.randomBytes). The unique DB index is the
 * final guarantee, so a rare collision is simply retried.
 */
async function generateTrackingId() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const trackingId = `TX-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    if (!await trackingIdExists(trackingId)) return trackingId;
  }
  throw new Error('Could not allocate a unique tracking id');
}

const validateAgentPayload = (body, { partial = false } = {}) => {
  const errors = {};

  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) errors.name = 'Agent name is required';
    else if (name.length > 80) errors.name = 'Agent name must be 80 characters or fewer';
  } else if (!partial) {
    errors.name = 'Agent name is required';
  }

  if (body.status !== undefined && !AGENT_STATUSES.includes(body.status)) {
    errors.status = `status must be one of: ${AGENT_STATUSES.join(', ')}`;
  }

  if (body.voice !== undefined && !AGENT_VOICES.includes(body.voice)) {
    errors.voice = `voice must be one of: ${AGENT_VOICES.join(', ')}`;
  }

  const MAX_KNOWLEDGE_BASE_CHARS = 20000;
  const KNOWLEDGE_BASE_FIELDS = ['description', 'serviceCatalog', 'clientProfiles', 'caseLibrary', 'guidelines'];

  for (const field of KNOWLEDGE_BASE_FIELDS) {
    if (body[field] === undefined || body[field] === null) continue;
    if (typeof body[field] !== 'string') {
      errors[field] = `${field} must be a string`;
    } else if (body[field].length > MAX_KNOWLEDGE_BASE_CHARS) {
      errors[field] = `${field} must be ${MAX_KNOWLEDGE_BASE_CHARS} characters or fewer`;
    }
  }

  for (const field of ['industry']) {
    if (body[field] === undefined || body[field] === null) continue;
    if (typeof body[field] !== 'string') {
      errors[field] = `${field} must be a string`;
    } else if (body[field].length > 4000) {
      errors[field] = `${field} must be 4000 characters or fewer`;
    }
  }

  if (body.documents !== undefined) {
    if (!Array.isArray(body.documents) || body.documents.some((d) => typeof d !== 'string')) {
      errors.documents = 'documents must be an array of strings';
    }
  }

  return errors;
};

// List the authenticated business's agents
app.get('/v1/agents', asyncHandler(async (req, res) => {
  const agents = await listAgents(req.business.id);
  res.status(200).json({ agents: agents.map(publicAgent) });
}));

// Create an agent, enforcing the business plan's agent limit
app.post('/v1/agents', asyncHandler(async (req, res) => {
  const errors = validateAgentPayload(req.body || {});
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ error: 'Validation failed', fields: errors });
  }

  const plan = req.business.plan || 'Free';
  const limit = PLAN_LIMITS[plan] ? PLAN_LIMITS[plan].agents : PLAN_LIMITS.Free.agents;
  if (await countAgents(req.business.id) >= limit) {
    return res.status(403).json({
      error: `Agent limit reached: your ${plan} plan supports up to ${limit} agent(s).`,
      code: 'PLAN_LIMIT_EXCEEDED',
    });
  }

  const body = req.body;
  const agent = await createAgent(req.business.id, {
    name: body.name.trim(),
    status: body.status || 'Active',
    industry: body.industry || 'General',
    voice: body.voice || 'professional',
    description: body.description ?? null,
    serviceCatalog: body.serviceCatalog ?? null,
    clientProfiles: body.clientProfiles ?? null,
    caseLibrary: body.caseLibrary ?? null,
    guidelines: body.guidelines ?? null,
    documents: Array.isArray(body.documents) ? body.documents : [],
  });

  res.status(201).json({ agent: publicAgent(agent) });
}));

// Get a single agent (scoped to the authenticated business)
app.get('/v1/agents/:id', asyncHandler(async (req, res) => {
  const agent = await getAgentById(req.business.id, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.status(200).json({ agent: publicAgent(agent) });
}));

// Update an agent (scoped to the authenticated business)
app.put('/v1/agents/:id', asyncHandler(async (req, res) => {
  const existing = await getAgentById(req.business.id, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Agent not found' });

  const errors = validateAgentPayload(req.body || {}, { partial: true });
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ error: 'Validation failed', fields: errors });
  }

  const updated = await updateAgent(req.business.id, req.params.id, req.body);
  res.status(200).json({ agent: publicAgent(updated) });
}));

// Delete an agent (scoped to the authenticated business)
app.delete('/v1/agents/:id', asyncHandler(async (req, res) => {
  if (!await deleteAgent(req.business.id, req.params.id)) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  res.status(200).json({ success: true });
}));

// List the authenticated business's touchpoints (with their connected agents)
app.get('/v1/touchpoints', asyncHandler(async (req, res) => {
  const touchpoints = await listTouchpoints(req.business.id);
  res.status(200).json({ touchpoints: touchpoints.map(publicTouchpoint) });
}));

// Create a touchpoint. The agent must belong to the same business and the
// tracking id is generated server-side.
app.post('/v1/touchpoints', asyncHandler(async (req, res) => {
  const body = req.body || {};

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'Touchpoint name is required' });
  if (name.length > 80) return res.status(400).json({ error: 'Touchpoint name must be 80 characters or fewer' });

  if (!SURFACE_TYPES.includes(body.type)) {
    return res.status(400).json({ error: `type must be one of: ${SURFACE_TYPES.join(', ')}` });
  }

  if (typeof body.agentId !== 'string' || !body.agentId) {
    return res.status(400).json({ error: 'agentId is required' });
  }

  const agent = await getAgentById(req.business.id, body.agentId);
  if (!agent) {
    return res.status(400).json({ error: 'The selected agent does not exist in this workspace' });
  }

  const location = typeof body.location === 'string' ? body.location.trim() : '';
  if (location.length > 200) {
    return res.status(400).json({ error: 'Location must be 200 characters or fewer' });
  }

  const plan = req.business.plan || 'Free';
  const limit = PLAN_LIMITS[plan] ? PLAN_LIMITS[plan].touchpoints : PLAN_LIMITS.Free.touchpoints;
  if (await countTouchpoints(req.business.id) >= limit) {
    return res.status(403).json({
      error: `Touchpoint limit reached: your ${plan} plan supports up to ${limit} touchpoint(s).`,
      code: 'PLAN_LIMIT_EXCEEDED',
    });
  }

  let trackingId;
  try {
    trackingId = await generateTrackingId();
  } catch (err) {
    return res.status(500).json({ error: 'Could not allocate a tracking id' });
  }

  const touchpoint = await createTouchpoint({
    businessId: req.business.id,
    agentId: agent.id,
    name,
    type: body.type,
    location,
    trackingId,
  });

  res.status(201).json({ touchpoint: publicTouchpoint(touchpoint) });
}));

// Get a single touchpoint (scoped to the authenticated business)
app.get('/v1/touchpoints/:id', asyncHandler(async (req, res) => {
  const touchpoint = await getTouchpointById(req.business.id, req.params.id);
  if (!touchpoint) return res.status(404).json({ error: 'Touchpoint not found' });
  res.status(200).json({ touchpoint: publicTouchpoint(touchpoint) });
}));

// Update a touchpoint (scoped to the authenticated business)
app.put('/v1/touchpoints/:id', asyncHandler(async (req, res) => {
  const existing = await getTouchpointById(req.business.id, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Touchpoint not found' });

  const body = req.body || {};

  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'Touchpoint name is required' });
    if (name.length > 80) return res.status(400).json({ error: 'Touchpoint name must be 80 characters or fewer' });
    body.name = name;
  }

  if (body.type !== undefined && !SURFACE_TYPES.includes(body.type)) {
    return res.status(400).json({ error: `type must be one of: ${SURFACE_TYPES.join(', ')}` });
  }

  if (body.agentId !== undefined) {
    if (typeof body.agentId !== 'string' || !body.agentId) {
      return res.status(400).json({ error: 'agentId must be a valid id' });
    }
    const agent = await getAgentById(req.business.id, body.agentId);
    if (!agent) {
      return res.status(400).json({ error: 'The selected agent does not exist in this workspace' });
    }
  }

  if (body.location !== undefined) {
    const location = typeof body.location === 'string' ? body.location.trim() : '';
    if (location.length > 200) return res.status(400).json({ error: 'Location must be 200 characters or fewer' });
    body.location = location;
  }

  if (body.active !== undefined && typeof body.active !== 'boolean') {
    return res.status(400).json({ error: 'active must be a boolean' });
  }

  const updated = await updateTouchpoint(req.business.id, req.params.id, body);
  res.status(200).json({ touchpoint: publicTouchpoint(updated) });
}));

// Delete a touchpoint (scoped to the authenticated business)
app.delete('/v1/touchpoints/:id', asyncHandler(async (req, res) => {
  if (!await deleteTouchpoint(req.business.id, req.params.id)) {
    return res.status(404).json({ error: 'Touchpoint not found' });
  }
  res.status(200).json({ success: true });
}));

/**
 * PUBLIC TOUCHPOINT CHAT (Phase 4)
 *
 * These routes sit OUTSIDE the workspace auth gate on purpose: a customer who
 * scans a QR code must be able to resolve and chat with the touchpoint without
 * an account. Authorization is possession of the server-generated tracking id
 * (64 bits of CSPRNG entropy). Tenant isolation is preserved because the
 * tracking id resolves to exactly one tenant-owned touchpoint, and every
 * conversation is only ever reachable through the tracking id of the
 * touchpoint that owns it — never through another touchpoint or business.
 */

const TRACKING_ID_RE = /^TX-[0-9a-f]{16}$/i;

async function resolvePublicTouchpoint(trackingId) {
  if (typeof trackingId !== 'string' || !TRACKING_ID_RE.test(trackingId)) return null;
  return await getTouchpointByTrackingId(trackingId);
}

const publicTouchpointInfo = (touchpoint) => ({
  trackingId: touchpoint.tracking_id,
  status: touchpoint.active ? 'active' : 'inactive',
  touchpoint: {
    name: touchpoint.name,
    type: touchpoint.type,
    location: touchpoint.location,
  },
  agent: {
    name: touchpoint.agent_name,
    status: touchpoint.agent_status,
    industry: touchpoint.agent_industry,
    voice: touchpoint.agent_voice,
  },
  business: { name: touchpoint.business_name },
});

// Public page template (built by Vite as dist/t.html). Loaded lazily and
// cached; the __TOUCHPOINT_DATA__ placeholder is replaced per request.
const PUBLIC_PAGE_PATH = path.join(__dirname, 'dist', 't.html');
let publicPageTemplate = null;

function getPublicPageTemplate() {
  // Cache the built template once it exists. If the server started before the
  // production build finished (empty template), keep retrying on each call so
  // the real dist/t.html is picked up as soon as it appears rather than being
  // replaced by the fallback forever.
  if (publicPageTemplate === null || publicPageTemplate === '') {
    try {
      const content = fs.readFileSync(PUBLIC_PAGE_PATH, 'utf8');
      if (content) publicPageTemplate = content;
    } catch (err) {
      // dist/t.html not built yet; fall back to the inline template below.
    }
  }
  return publicPageTemplate || `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Touchpoint Chat</title></head>
<body style="font-family: system-ui, sans-serif; background:#f8fafc; margin:0; padding:24px;">
<div id="root"></div>
<script type="application/json" id="touchpoint-data">__TOUCHPOINT_DATA__</script>
</body>
</html>`;
}

function renderPublicPage(payload) {
  const template = getPublicPageTemplate();

  // The payload is untrusted-ish JSON (business-supplied agent names etc.),
  // so HTML-significant characters are escaped to prevent any script breakout.
  const json = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');

  return template.replace('__TOUCHPOINT_DATA__', json);
}

// Resolve a tracking id to its public info. A scan is NOT recorded here; only
// the HTML page route counts as a physical scan so a single page load is never
// double-counted by the page's own JSON fetch.
app.get('/v1/t/:trackingId', asyncHandler(async (req, res) => {
  const touchpoint = await resolvePublicTouchpoint(req.params.trackingId);
  if (!touchpoint) return res.status(404).json({ error: 'Touchpoint not found' });
  if (!touchpoint.active) return res.status(410).json({ error: 'This touchpoint is no longer active' });
  res.json(publicTouchpointInfo(touchpoint));
}));

// Fetch a conversation's message history so a returning customer can resume.
// The conversation id is only honored if it belongs to the touchpoint named by
// the tracking id in the URL — cross-touchpoint/cross-tenant ids get 404.
app.get('/v1/t/:trackingId/messages', asyncHandler(async (req, res) => {
  const touchpoint = await resolvePublicTouchpoint(req.params.trackingId);
  if (!touchpoint) return res.status(404).json({ error: 'Touchpoint not found' });
  if (!touchpoint.active) return res.status(410).json({ error: 'This touchpoint is no longer active' });

  const conversationId = typeof req.query.conversationId === 'string' ? req.query.conversationId : '';
  if (!conversationId) return res.json({ conversationId: null, messages: [] });

  const conversation = await getConversationById(conversationId);
  if (!conversation || conversation.touchpoint_id !== touchpoint.id) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  res.json({
    conversationId: conversation.id,
    customerName: conversation.customer_name || null,
    targetLanguage: conversation.target_language,
    messages: await listConversationMessages(conversation.id),
  });
}));

// Send a message in a public touchpoint conversation. Creates the conversation
// on first contact, persists both sides of the exchange, and drives the same
// Groq logic as the authenticated sandbox.
app.post('/v1/t/:trackingId/messages', asyncHandler(async (req, res) => {
  const touchpoint = await resolvePublicTouchpoint(req.params.trackingId);
  if (!touchpoint) return res.status(404).json({ error: 'Touchpoint not found' });
  if (!touchpoint.active) return res.status(410).json({ error: 'This touchpoint is no longer active' });

  const body = req.body || {};

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'message is required' });
  if (message.length > 2000) {
    return res.status(400).json({ error: 'message must be 2000 characters or fewer' });
  }

  let customerName = null;
  if (body.customerName !== undefined && body.customerName !== null) {
    if (typeof body.customerName !== 'string') {
      return res.status(400).json({ error: 'customerName must be a string' });
    }
    customerName = body.customerName.trim();
    if (customerName.length > 120) {
      return res.status(400).json({ error: 'customerName must be 120 characters or fewer' });
    }
    if (!customerName) customerName = null;
  }

  let targetLanguage = 'en';
  if (body.targetLanguage !== undefined && body.targetLanguage !== null) {
    if (typeof body.targetLanguage !== 'string') {
      return res.status(400).json({ error: 'targetLanguage must be a string' });
    }
    targetLanguage = body.targetLanguage.trim().toLowerCase();
    if (!/^[a-z]{2,8}$/.test(targetLanguage)) {
      return res.status(400).json({ error: 'targetLanguage must be an ISO language code' });
    }
  }

  let conversation = null;
  if (body.conversationId !== undefined && body.conversationId !== null && body.conversationId !== '') {
    if (typeof body.conversationId !== 'string') {
      return res.status(400).json({ error: 'conversationId must be a string' });
    }
    conversation = await getConversationById(body.conversationId);
    // The conversation must belong to THIS touchpoint — otherwise the tracking
    // id becomes an oracle for another tenant's conversations.
    if (!conversation || conversation.touchpoint_id !== touchpoint.id) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
  }

  if (!conversation) {
    conversation = await createConversation({
      touchpoint,
      agentId: touchpoint.agent_id,
      customerName,
      targetLanguage,
    });
  }

  const agent = await getAgentById(touchpoint.business_id, touchpoint.agent_id);
  if (!agent) {
    return res.status(500).json({ error: 'The assigned agent is unavailable' });
  }

  const history = await listConversationMessages(conversation.id);
  let replyText;
  try {
    replyText = await runAgentChat({
      agent: { ...agent, catalog: agent.service_catalog },
      history,
      userInput: message,
      targetLanguage,
    });
  } catch (error) {
    // Never surface the provider error to a customer: log the full detail
    // server-side and fall through to the same graceful reply used for an
    // empty AI response, so the conversation continues and nothing internal
    // leaks to the public endpoint.
    console.error("[Public Touchpoint] Groq Error:", error);
  }

  if (typeof replyText !== 'string' || !replyText.trim()) {
    replyText = AI_FALLBACK_REPLY;
  }

  await addConversationMessage({ conversationId: conversation.id, role: 'user', text: message });
  await addConversationMessage({ conversationId: conversation.id, role: 'assistant', text: replyText });

  // Phase 5: extract and persist a lead from the exchange. Failures here are
  // logged and swallowed so a transient AI hiccup never breaks the chat.
  try {
    await captureLeadFromConversation({ conversation, touchpoint, agent });
  } catch (error) {
    console.error('[Lead Capture] Extraction error:', error);
  }

  const fresh = await getConversationById(conversation.id);
  res.json({
    conversationId: conversation.id,
    customerName: fresh.customer_name || null,
    targetLanguage: fresh.target_language,
    agent: { name: fresh.agent_name },
    messages: await listConversationMessages(conversation.id),
  });
}));

// Public HTML page. Resolves the tracking id, records the physical scan, and
// serves the customer-facing chat UI with the resolved payload embedded.
app.get('/t/:trackingId', asyncHandler(async (req, res) => {
  const touchpoint = await resolvePublicTouchpoint(req.params.trackingId);
  res.set('Cache-Control', 'no-store');
  res.type('html');

  if (!touchpoint) {
    return res.status(404).send(renderPublicPage({
      status: 'not_found',
      trackingId: req.params.trackingId,
    }));
  }

  // Inactive touchpoints are not counted as scans and show a closed message.
  if (!touchpoint.active) {
    return res.send(renderPublicPage(publicTouchpointInfo(touchpoint)));
  }

  await recordScan({
    touchpointId: touchpoint.id,
    businessId: touchpoint.business_id,
    userAgent: req.get('user-agent'),
  });

  res.send(renderPublicPage(publicTouchpointInfo(touchpoint)));
}));

// Authenticated dashboard: list the business's persisted conversations.
app.get('/v1/conversations', asyncHandler(async (req, res) => {
  const conversations = (await listConversations(req.business.id)).map((c) => ({
    id: c.id,
    touchpointId: c.touchpoint_id,
    touchpointName: c.touchpoint_name,
    agentId: c.agent_id,
    agentName: c.agent_name,
    customerName: c.customer_name,
    targetLanguage: c.target_language,
    lastMessage: c.last_message,
    messageCount: c.message_count,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }));
  res.status(200).json({ conversations });
}));

/**
 * LEADS & NOTIFICATIONS (Phase 5)
 * Every handler derives the tenant from the authenticated session
 * (req.business.id). A business_id or foreign conversation/touchpoint id
 * supplied by the client is never trusted for scoping.
 */

const publicLead = (lead) => ({
  id: lead.id,
  name: lead.name,
  phone: lead.phone,
  email: lead.email,
  intent: lead.intent,
  qualificationScore: lead.qualification_score,
  qualificationStatus: lead.qualification_status,
  source: lead.source,
  notified: lead.notified,
  touchpointId: lead.touchpoint_id,
  touchpointName: lead.touchpoint_name,
  agentId: lead.agent_id,
  agentName: lead.agent_name,
  conversationId: lead.conversation_id,
  createdAt: lead.created_at,
  updatedAt: lead.updated_at,
});

const publicLeadNotification = (n) => ({
  id: n.id,
  leadId: n.lead_id,
  leadName: n.lead_name,
  phone: n.phone,
  email: n.email,
  qualificationScore: n.qualification_score,
  qualificationStatus: n.qualification_status,
  readAt: n.read_at,
  createdAt: n.created_at,
});

// List the authenticated business's leads, newest activity first.
app.get('/v1/leads', asyncHandler(async (req, res) => {
  res.status(200).json({ leads: (await listLeads(req.business.id)).map(publicLead) });
}));

// In-app notifications for newly qualified leads (unread first).
app.get('/v1/leads/notifications', asyncHandler(async (req, res) => {
  const notifications = (await listLeadNotifications(req.business.id)).map(publicLeadNotification);
  res.status(200).json({
    notifications,
    unread: await countUnreadLeadNotifications(req.business.id),
  });
}));

// Mark the business's lead notifications as read.
app.post('/v1/leads/notifications/read', asyncHandler(async (req, res) => {
  const marked = await markLeadNotificationsRead(req.business.id);
  res.status(200).json({ success: true, marked, unread: 0 });
}));

// Create a lead manually (e.g. a salesperson logging a call). Plan limit is
// enforced server-side using the shared PLAN_LIMITS architecture.
app.post('/v1/leads', asyncHandler(async (req, res) => {
  const body = req.body || {};

  const name = cleanString(body.name, 120);
  const phone = body.phone === undefined || body.phone === null ? null : cleanPhone(body.phone);
  const email = body.email === undefined || body.email === null ? null : cleanEmail(body.email);
  const intent = cleanString(body.intent, 500);

  const errors = {};
  if (body.name !== undefined && body.name !== null && !name) {
    errors.name = 'name must be a non-empty string of 120 characters or fewer';
  }
  if (body.phone !== undefined && body.phone !== null && phone === null) {
    errors.phone = 'phone must be a valid phone number';
  }
  if (body.email !== undefined && body.email !== null && email === null) {
    errors.email = 'email must be a valid email address';
  }
  if (body.intent !== undefined && body.intent !== null && !intent) {
    errors.intent = 'intent must be a non-empty string of 500 characters or fewer';
  }

  let qualificationScore = null;
  if (body.qualificationScore !== undefined && body.qualificationScore !== null) {
    const score = Number(body.qualificationScore);
    if (!Number.isInteger(score) || score < 0 || score > 100) {
      errors.qualificationScore = 'qualificationScore must be an integer between 0 and 100';
    } else {
      qualificationScore = score;
    }
  }

  let qualificationStatus = null;
  if (body.qualificationStatus !== undefined && body.qualificationStatus !== null) {
    if (!LEAD_STATUSES.includes(body.qualificationStatus)) {
      errors.qualificationStatus = `qualificationStatus must be one of: ${LEAD_STATUSES.join(', ')}`;
    } else {
      qualificationStatus = body.qualificationStatus;
    }
  }

  if (!name && !phone && !email) {
    errors.contact = 'At least one of name, phone or email is required';
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ error: 'Validation failed', fields: errors });
  }

  let conversationId = null;
  if (body.conversationId !== undefined && body.conversationId !== null && body.conversationId !== '') {
    if (typeof body.conversationId !== 'string') {
      return res.status(400).json({ error: 'conversationId must be a string' });
    }
    const conversation = await getConversationById(body.conversationId);
    if (!conversation || conversation.business_id !== req.business.id) {
      return res.status(400).json({ error: 'The referenced conversation does not exist in this workspace' });
    }
    conversationId = conversation.id;
  }

  let touchpointId = null;
  if (body.touchpointId !== undefined && body.touchpointId !== null && body.touchpointId !== '') {
    if (typeof body.touchpointId !== 'string') {
      return res.status(400).json({ error: 'touchpointId must be a string' });
    }
    const touchpoint = await getTouchpointById(req.business.id, body.touchpointId);
    if (!touchpoint) {
      return res.status(400).json({ error: 'The referenced touchpoint does not exist in this workspace' });
    }
    touchpointId = touchpoint.id;
  }

  // Deterministic server-side defaulting: a supplied score derives its status.
  if (qualificationStatus === null && qualificationScore !== null) {
    qualificationStatus = scoreToQualificationStatus(qualificationScore);
  }
  if (qualificationStatus === null) {
    qualificationStatus = 'pending';
  }
  if (qualificationScore === null) {
    qualificationScore = qualificationStatus === 'qualified' ? 60 : 0;
  }

  if (conversationId && await findLeadByConversation(req.business.id, conversationId)) {
    return res.status(409).json({ error: 'A lead already exists for this conversation' });
  }

  const limits = PLAN_LIMITS[req.business.plan || 'Free'] || PLAN_LIMITS.Free;
  if (await countLeads(req.business.id) >= limits.leads) {
    return res.status(403).json({
      error: `Lead limit reached: your ${req.business.plan || 'Free'} plan supports up to ${limits.leads} lead(s).`,
      code: 'PLAN_LIMIT_EXCEEDED',
    });
  }

  let agentId = null;
  if (conversationId) {
    const conv = await getConversationById(conversationId);
    agentId = conv.agent_id;
  }

  const lead = await createLead({
    businessId: req.business.id,
    touchpointId,
    conversationId,
    agentId,
    name,
    phone,
    email,
    intent,
    qualificationScore,
    qualificationStatus,
    source: 'manual',
  });

  if (lead.qualification_status === 'qualified' && !lead.notified) {
    await createLeadNotification({ businessId: req.business.id, leadId: lead.id });
  }

  res.status(201).json({ lead: publicLead(lead) });
}));

// Get a single lead (scoped to the authenticated business)
app.get('/v1/leads/:id', asyncHandler(async (req, res) => {
  const lead = await getLeadById(req.business.id, req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  res.status(200).json({ lead: publicLead(lead) });
}));

// Update a lead's contact/qualification fields (scoped to the authenticated
// business). Qualification status is validated against the deterministic enum.
app.put('/v1/leads/:id', asyncHandler(async (req, res) => {
  const existing = await getLeadById(req.business.id, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Lead not found' });

  const body = req.body || {};
  const updates = {};

  if (body.name !== undefined && body.name !== null) {
    const name = cleanString(body.name, 120);
    if (!name) return res.status(400).json({ error: 'name must be a non-empty string of 120 characters or fewer' });
    updates.name = name;
  }
  if (body.phone !== undefined && body.phone !== null) {
    const phone = cleanPhone(body.phone);
    if (!phone) return res.status(400).json({ error: 'phone must be a valid phone number' });
    updates.phone = phone;
  }
  if (body.email !== undefined && body.email !== null) {
    const email = cleanEmail(body.email);
    if (!email) return res.status(400).json({ error: 'email must be a valid email address' });
    updates.email = email;
  }
  if (body.intent !== undefined && body.intent !== null) {
    const intent = cleanString(body.intent, 500);
    if (!intent) return res.status(400).json({ error: 'intent must be a non-empty string of 500 characters or fewer' });
    updates.intent = intent;
  }
  if (body.qualificationScore !== undefined && body.qualificationScore !== null) {
    const score = Number(body.qualificationScore);
    if (!Number.isInteger(score) || score < 0 || score > 100) {
      return res.status(400).json({ error: 'qualificationScore must be an integer between 0 and 100' });
    }
    updates.qualificationScore = score;
  }
  if (body.qualificationStatus !== undefined && body.qualificationStatus !== null) {
    if (!LEAD_STATUSES.includes(body.qualificationStatus)) {
      return res.status(400).json({ error: `qualificationStatus must be one of: ${LEAD_STATUSES.join(', ')}` });
    }
    updates.qualificationStatus = body.qualificationStatus;
  }

  // Score without status derives its status deterministically, so the two can
  // never disagree in the database.
  if (updates.qualificationStatus === undefined && updates.qualificationScore !== undefined) {
    updates.qualificationStatus = scoreToQualificationStatus(updates.qualificationScore);
  }
  if (Object.keys(updates).length === 0) {
    return res.status(200).json({ lead: publicLead(existing) });
  }

  const updated = await updateLead(req.business.id, req.params.id, updates);
  if (!updated) return res.status(404).json({ error: 'Lead not found' });

  if (updated.qualification_status === 'qualified' && !updated.notified) {
    await createLeadNotification({ businessId: req.business.id, leadId: updated.id });
  }

  res.status(200).json({ lead: publicLead(updated) });
}));

/**
 * ANALYTICS (Phase 6)
 *
 * Every metric is derived on demand from the tenant's own persisted rows
 * (touchpoint_scans, conversations, leads) — nothing is cached, hardcoded, or
 * simulated. The session's business id scopes every query; a business_id
 * supplied by the client is never read. `range` is validated against a fixed
 * whitelist so garbage input cannot skew aggregations.
 */

const ANALYTICS_RANGES = ['24h', '7d', '30d', 'all'];
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const ANALYTICS_SUMMARY_SOURCES = ['scans', 'conversations', 'leads'];

function analyticsRangeParam(req) {
  const raw = req.query.range;
  if (raw === undefined || raw === null || raw === '') return '7d';
  if (typeof raw !== 'string' || !ANALYTICS_RANGES.includes(raw)) return null;
  return raw;
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Percentage change between two windows, rounded to one decimal. null when the
 * previous window had no activity (the change is mathematically undefined, so
 * the UI shows a neutral state instead of a fabricated number).
 */
function pctChange(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Describes the time window for a validated range: the bucket unit, the
 * [start, end) query bounds, the equivalent previous window for deltas, and
 * the SQL expression that assigns a row to a bucket label.
 */
function analyticsWindow(range) {
  const now = new Date();
  if (range === '24h') {
    const start = new Date(now.getTime() - 24 * HOUR_MS);
    const prevStart = new Date(start.getTime() - 24 * HOUR_MS);
    return {
      unit: 'hour',
      start,
      end: now,
      prevStart,
      bucketExpr: "substr(created_at, 1, 13) || ':00'",
    };
  }
  const days = range === '7d' ? 7 : 30;
  const todayStart = startOfUtcDay(now);
  const start = new Date(todayStart.getTime() - (days - 1) * DAY_MS);
  const end = new Date(todayStart.getTime() + DAY_MS);
  const prevStart = new Date(start.getTime() - days * DAY_MS);
  return {
    unit: 'day',
    start,
    end,
    prevStart,
    bucketExpr: 'substr(created_at, 1, 10)',
  };
}

function bucketLabels(start, end, unit) {
  const step = unit === 'hour' ? HOUR_MS : DAY_MS;
  const first = Math.floor(start.getTime() / step) * step;
  const labels = [];
  for (let t = first; t < end.getTime(); t += step) {
    const date = new Date(t);
    labels.push(unit === 'hour'
      ? `${date.toISOString().slice(0, 13).replace('T', ' ')}:00`
      : date.toISOString().slice(0, 10));
  }
  return labels;
}

function countByBucket(rows, labels) {
  const byBucket = new Map(rows.map((row) => [row.bucket, row.count]));
  return labels.map((label) => byBucket.get(label) || 0);
}

/**
 * Builds the zero-filled trend series for a validated range. Every bucket in
 * the window is present; counts are always derived from real rows, so a quiet
 * tenant gets zeros rather than fabricated activity.
 */
async function buildTrends(businessId, range) {
  const window = analyticsWindow(range);
  const labels = bucketLabels(window.start, window.end, window.unit);
  const start = toSqlDateTime(window.start);
  const end = toSqlDateTime(window.end);

  const series = {
    scans: countByBucket(
      await analyticsBucketCounts(businessId, 'scans', { start, end, bucketExpr: window.bucketExpr }),
      labels,
    ),
    conversations: countByBucket(
      await analyticsBucketCounts(businessId, 'conversations', { start, end, bucketExpr: window.bucketExpr }),
      labels,
    ),
    leads: countByBucket(
      await analyticsBucketCounts(businessId, 'leads', { start, end, bucketExpr: window.bucketExpr }),
      labels,
    ),
    qualifiedLeads: countByBucket(
      await analyticsBucketCounts(businessId, 'leads', { start, end, bucketExpr: window.bucketExpr, qualifiedOnly: true }),
      labels,
    ),
  };

  return {
    unit: window.unit,
    start,
    end,
    points: labels.map((label, index) => ({
      date: label,
      scans: series.scans[index],
      conversations: series.conversations[index],
      leads: series.leads[index],
      qualifiedLeads: series.qualifiedLeads[index],
    })),
  };
}

// Summary + trend series for the whole workspace.
app.get('/v1/analytics/overview', asyncHandler(async (req, res) => {
  const range = analyticsRangeParam(req);
  if (!range) {
    return res.status(400).json({ error: `range must be one of: ${ANALYTICS_RANGES.join(', ')}` });
  }

  const totals = {};
  const deltas = {};
  let trends = null;

  if (range === 'all') {
    for (const source of ANALYTICS_SUMMARY_SOURCES) {
      totals[source] = await countAnalyticsRows(req.business.id, source);
      deltas[source] = null;
    }
    totals.qualifiedLeads = await countAnalyticsRows(req.business.id, 'leads', { qualifiedOnly: true });
    deltas.qualifiedLeads = null;
  } else {
    const window = analyticsWindow(range);
    const start = toSqlDateTime(window.start);
    const end = toSqlDateTime(window.end);
    const prevStart = toSqlDateTime(window.prevStart);

    for (const source of ANALYTICS_SUMMARY_SOURCES) {
      totals[source] = await countAnalyticsRows(req.business.id, source, { start, end });
      deltas[source] = pctChange(
        totals[source],
        await countAnalyticsRows(req.business.id, source, { start: prevStart, end: start }),
      );
    }
    totals.qualifiedLeads = await countAnalyticsRows(req.business.id, 'leads', { start, end, qualifiedOnly: true });
    deltas.qualifiedLeads = pctChange(
      totals.qualifiedLeads,
      await countAnalyticsRows(req.business.id, 'leads', { start: prevStart, end: start, qualifiedOnly: true }),
    );
    trends = await buildTrends(req.business.id, range);
  }

  const qualificationRate = totals.leads > 0
    ? Math.round((totals.qualifiedLeads / totals.leads) * 1000) / 10
    : 0;

  res.json({ range, totals, deltas, qualificationRate, trends });
}));

// Per-touchpoint performance: real scans, conversations, leads and qualified
// leads for every node in the workspace (quiet nodes report honest zeros).
app.get('/v1/analytics/touchpoints', asyncHandler(async (req, res) => {
  const range = analyticsRangeParam(req);
  if (!range) {
    return res.status(400).json({ error: `range must be one of: ${ANALYTICS_RANGES.join(', ')}` });
  }

  const bounds = range === 'all'
    ? { start: null, end: null }
    : (() => {
        const window = analyticsWindow(range);
        return { start: toSqlDateTime(window.start), end: toSqlDateTime(window.end) };
      })();

  const scans = new Map((await analyticsGroupedCounts(req.business.id, 'scans', { ...bounds, groupBy: 'touchpoint_id' })).map((row) => [row.id, row.count]));
  const conversations = new Map((await analyticsGroupedCounts(req.business.id, 'conversations', { ...bounds, groupBy: 'touchpoint_id' })).map((row) => [row.id, row.count]));
  const leads = new Map((await analyticsGroupedCounts(req.business.id, 'leads', { ...bounds, groupBy: 'touchpoint_id' })).map((row) => [row.id, row.count]));
  const qualified = new Map((await analyticsGroupedCounts(req.business.id, 'leads', { ...bounds, groupBy: 'touchpoint_id', qualifiedOnly: true })).map((row) => [row.id, row.count]));

  const touchpoints = (await listTouchpoints(req.business.id))
    .map((tp) => {
      const tpLeads = leads.get(tp.id) || 0;
      const tpQualified = qualified.get(tp.id) || 0;
      return {
        id: tp.id,
        name: tp.name,
        type: tp.type,
        location: tp.location,
        active: tp.active,
        trackingId: tp.tracking_id,
        agentId: tp.agent_id,
        agentName: tp.agent_name,
        scans: scans.get(tp.id) || 0,
        conversations: conversations.get(tp.id) || 0,
        leads: tpLeads,
        qualifiedLeads: tpQualified,
        qualificationRate: tpLeads > 0 ? Math.round((tpQualified / tpLeads) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.scans - a.scans || b.leads - a.leads);

  res.json({ range, touchpoints });
}));

// Per-agent performance: conversations and leads attributed to each agent.
// Manual leads logged without an anchor are workspace-wide only and never
// misattributed here.
app.get('/v1/analytics/agents', asyncHandler(async (req, res) => {
  const range = analyticsRangeParam(req);
  if (!range) {
    return res.status(400).json({ error: `range must be one of: ${ANALYTICS_RANGES.join(', ')}` });
  }

  const bounds = range === 'all'
    ? { start: null, end: null }
    : (() => {
        const window = analyticsWindow(range);
        return { start: toSqlDateTime(window.start), end: toSqlDateTime(window.end) };
      })();

  const conversations = new Map((await analyticsGroupedCounts(req.business.id, 'conversations', { ...bounds, groupBy: 'agent_id' })).map((row) => [row.id, row.count]));
  const leads = new Map((await analyticsGroupedCounts(req.business.id, 'leads', { ...bounds, groupBy: 'agent_id' })).map((row) => [row.id, row.count]));
  const qualified = new Map((await analyticsGroupedCounts(req.business.id, 'leads', { ...bounds, groupBy: 'agent_id', qualifiedOnly: true })).map((row) => [row.id, row.count]));

  const agents = (await listAgents(req.business.id))
    .map((agent) => {
      const agentLeads = leads.get(agent.id) || 0;
      const agentQualified = qualified.get(agent.id) || 0;
      return {
        id: agent.id,
        name: agent.name,
        status: agent.status,
        conversations: conversations.get(agent.id) || 0,
        leads: agentLeads,
        qualifiedLeads: agentQualified,
        qualificationRate: agentLeads > 0 ? Math.round((agentQualified / agentLeads) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.leads - a.leads || b.conversations - a.conversations);

  res.json({ range, agents });
}));

/**
 * BILLING ENDPOINTS (Phase 7)
 * Every handler derives the tenant from the authenticated session
 * (req.business.id). A business_id or reference supplied by the client is never
 * trusted for scoping — cross-tenant references are rejected with 403.
 */

// The tenant's persisted subscription state (the source of truth the UI reads).
app.get('/v1/billing/subscription', asyncHandler(async (req, res) => {
  res.json({ subscription: await getPublicSubscription(req.business.id) });
}));

/**
 * Initializes a checkout. The server alone decides the plan, price, currency,
 * reference, and tenant; the client merely receives a Paystack access code to
 * complete payment. "Free" is not a checkout: selecting it downgrades the
 * workspace server-side (cancelling any live Paystack subscription).
 */
app.post('/v1/billing/initialize', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const plan = typeof body.plan === 'string' ? body.plan : '';
  const currency = typeof body.currency === 'string' ? body.currency.toUpperCase() : 'NGN';

  if (!PLAN_LIMITS[plan]) {
    return res.status(400).json({ error: 'Unknown plan' });
  }
  if (!PAYSTACK_CURRENCIES.includes(currency)) {
    return res.status(400).json({ error: `currency must be one of: ${PAYSTACK_CURRENCIES.join(', ')}` });
  }

  if (plan === 'Free') {
    await cancelPaystackSubscription(req.business.id);
    await upsertSubscription(req.business.id, {
      plan: 'Free',
      status: 'active',
      cancelledAt: null,
      expiresAt: null,
      lastReference: null,
    });
    return res.json({ subscription: await getPublicSubscription(req.business.id) });
  }

  const price = PLAN_LIMITS[plan].price[currency];
  if (typeof price !== 'number' || price <= 0) {
    return res.status(400).json({ error: 'This plan is not available for online checkout' });
  }

  const planCode = process.env[PAYSTACK_PLAN_CODE_ENV[plan]] || null;
  const amount = price * 100; // Paystack amounts are in the currency's subunit.
  const reference = `TXP-${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;

  let customerCode;
  try {
    customerCode = await ensurePaystackCustomer({ user: req.user, business: req.business });
  } catch (err) {
    return res.status(err.status || 502).json({ error: 'Could not set up the Paystack customer' });
  }

  let result;
  try {
    result = await paystackClient.initialize({
      amount,
      email: req.user.email,
      currency,
      reference,
      planCode,
      callbackUrl: `${APP_URL}/settings`,
      metadata: { business_id: req.business.id, plan, customer_code: customerCode },
    });
  } catch (err) {
    console.error('[Billing] Paystack initialize failed:', err.message);
    return res.status(502).json({ error: 'Could not initialize payment with Paystack' });
  }

  if (!result || result.status !== true || !result.data || !result.data.access_code) {
    return res.status(502).json({ error: 'Paystack did not return a checkout code' });
  }

  await createPaystackTransaction({
    reference,
    businessId: req.business.id,
    plan,
    currency,
    amount,
    planCode,
  });

  res.status(201).json({
    reference,
    accessCode: result.data.access_code,
    authorizationUrl: result.data.authorization_url,
    plan,
    currency,
    amount,
    email: req.user.email,
    subscription: await getPublicSubscription(req.business.id),
  });
}));

/**
 * Server-side verification of a transaction. This is the only place a client
 * callback ("payment succeeded") can influence state, and even then only after
 * Paystack confirms the charge server-side and every amount/currency/plan-code
 * cross-check passes. Rejects cross-tenant references with 403.
 */
app.get('/v1/billing/verify', asyncHandler(async (req, res) => {
  const reference = typeof req.query.reference === 'string' ? req.query.reference : '';
  if (!reference) return res.status(400).json({ error: 'reference is required' });

  const transaction = await getPaystackTransaction(reference);
  if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
  if (transaction.business_id !== req.business.id) {
    return res.status(403).json({ error: 'Not authorized to verify this transaction' });
  }

  if (transaction.status !== 'pending') {
    return res.json({
      transaction: { reference, status: transaction.status },
      subscription: await getPublicSubscription(req.business.id),
    });
  }

  let result;
  try {
    result = await paystackClient.verify(reference);
  } catch (err) {
    console.error('[Billing] Paystack verify failed:', err.message);
    return res.status(502).json({ error: 'Could not verify the payment with Paystack' });
  }

  if (result && result.status === true && result.data && result.data.status === 'success') {
    await applySuccessfulCharge({ transaction, payload: result.data });
  } else if (result && result.data) {
    const status = result.data.status || 'failed';
    await markChargeFailed(reference, status === 'abandoned' ? 'abandoned' : 'failed', 'client_verify', status);
  } else {
    await markChargeFailed(reference, 'failed', 'client_verify', 'unverifiable');
  }

  res.json({
    transaction: { reference, status: (await getPaystackTransaction(reference)).status },
    subscription: await getPublicSubscription(req.business.id),
  });
}));

/**
 * Cancels the tenant's Paystack subscription. The tier is kept until the paid
 * period ends (resolveSubscription then auto-expires it to Free).
 */
app.post('/v1/billing/cancel', asyncHandler(async (req, res) => {
  await cancelPaystackSubscription(req.business.id);
  await upsertSubscription(req.business.id, {
    status: 'cancelled',
    cancelledAt: nowPg(),
  });
  res.json({ subscription: await getPublicSubscription(req.business.id) });
}));

/**
 * ERROR HANDLING
 */

// Unknown /v1 API routes return JSON instead of the SPA shell
app.use('/v1', (req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// SPA Catch-all: Serve index.html for any unknown non-API GET routes. Never
// cached, and a clear 503 when the production build has not been produced yet
// (instead of an opaque sendFile error).
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  res.status(503).type('html').send('The application is not built yet. Run `yarn build` and restart the server.');
});

// Central error handler (must stay last so errors from any handler are caught)
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: "Invalid JSON payload" });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: "Payload too large" });
  }

  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error("[Server Error]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
  res.status(status).json({ error: err.message || "Request failed" });
});

/**
 * START SERVER
 */
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  const server = app.listen(PORT, () => {
    console.log(`
  🚀 Touchpoint AI (Monolith) is running!
  ------------------------------------
  Environment:    ${config.nodeEnv}
  App URL:        ${APP_URL}
  API Endpoint:   ${APP_URL}/v1
  Public Route:   ${APP_URL}/t/TX-<tracking-id>
  Health Check:   ${APP_URL}/v1/health
  ------------------------------------
  `);
  });

  // Graceful shutdown: stop accepting connections and close the database pool
  // so no in-flight queries are abandoned.
  const shutdown = (signal) => {
    console.log(`\n[Server] Received ${signal}, shutting down gracefully...`);
    server.close(() => {
      try {
        closeDatabase();
      } catch (err) {
        console.error('[Server] Error closing database:', err.message);
      }
      process.exit(0);
    });
    // If connections refuse to drain, force exit after 10 seconds.
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export default app;
