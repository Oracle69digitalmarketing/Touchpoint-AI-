
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_FILE = path.join(DATA_DIR, 'touchpoint.db');
const db = new Database(DB_FILE);

// ─── PRODUCTION DATABASE CONFIGURATION ────────────────────────────────────
// WAL is durable and far friendlier to concurrent readers (one Express
// process, many simultaneous requests). NORMAL synchronous still never loses
// a committed transaction in a process crash — it only relaxes durability for
// the last commit in a power-loss scenario, and is the standard production
// pairing for WAL. busy_timeout serializes writers instead of failing with
// SQLITE_BUSY. cache_size and temp_store keep hot working sets in memory.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('cache_size = -20000'); // ~20MB page cache
db.pragma('temp_store = MEMORY');
db.pragma('foreign_keys = ON');

/**
 * Restricts the data directory and database files so other OS users cannot
 * read tenant data (password hashes, leads, conversations). The SQLite side
 * files (-wal / -shm) inherit creation permissions, so any that already exist
 * are tightened too. Best-effort: chmod is a POSIX concept and can fail on
 * unusual filesystems; a failure only warns rather than killing the server.
 */
function lockDownDataFiles() {
  try {
    fs.chmodSync(DATA_DIR, 0o700);
    for (const suffix of ['', '-wal', '-shm']) {
      const file = DB_FILE + suffix;
      if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
    }
  } catch (err) {
    console.warn('[DB] Could not restrict data file permissions:', err.message);
  }
}

// In production the database is verified before the server accepts traffic so
// a corrupt file fails the deployment loudly instead of surfacing mid-request.
// Disable with DB_SKIP_INTEGRITY_CHECK=1 if the check ever becomes a cost.
if (process.env.NODE_ENV === 'production' && process.env.DB_SKIP_INTEGRITY_CHECK !== '1') {
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') {
    throw new Error(`SQLite integrity check failed for ${DB_FILE}: ${integrity}`);
  }
}

lockDownDataFiles();

/**
 * Live database round-trip used by /v1/health so deployment health checks see
 * whether the store is actually usable, not just that the process is up.
 */
export function pingDatabase() {
  return db.prepare('SELECT 1 AS ok').get().ok === 1;
}

/**
 * Checkpoints the WAL into the main database file and closes the handle. Used
 * on graceful shutdown so a fresh deploy never has to replay the journal.
 * Idempotent and safe to call once.
 */
export function closeDatabase() {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    console.warn('[DB] WAL checkpoint failed during shutdown:', err.message);
  }
  if (db.open) db.close();
}

// SQLite's datetime('now') returns "YYYY-MM-DD HH:MM:SS" in UTC.
// Keep every timestamp in that exact format so comparisons stay consistent.
export const toSqliteDateTime = (date) => date.toISOString().slice(0, 19).replace('T', ' ');

/**
 * Creates the schema if it does not already exist.
 * Idempotent, safe to run on every server start. Also migrates the Phase 1
 * crm_connections table into the Phase 2 business-scoped layout.
 */
export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS businesses (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      slug       TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      business_id   TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name          TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'owner',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      business_id TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at  TEXT NOT NULL,
      revoked_at  TEXT,
      FOREIGN KEY (user_id)     REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agents (
      id              TEXT PRIMARY KEY,
      business_id     TEXT NOT NULL,
      name            TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'Active',
      industry        TEXT NOT NULL DEFAULT 'General',
      voice           TEXT NOT NULL DEFAULT 'professional',
      description     TEXT,
      service_catalog TEXT,
      client_profiles TEXT,
      case_library    TEXT,
      guidelines      TEXT,
      documents       TEXT NOT NULL DEFAULT '[]',
      leads_generated INTEGER NOT NULL DEFAULT 0,
      conversion_rate REAL NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS touchpoints (
      id          TEXT PRIMARY KEY,
      business_id TEXT NOT NULL,
      agent_id    TEXT NOT NULL,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL,
      location    TEXT NOT NULL DEFAULT '',
      tracking_id TEXT NOT NULL UNIQUE,
      scans       INTEGER NOT NULL DEFAULT 0,
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id)    REFERENCES agents(id)    ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS touchpoint_scans (
      id           TEXT PRIMARY KEY,
      touchpoint_id TEXT NOT NULL,
      business_id  TEXT NOT NULL,
      user_agent   TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (touchpoint_id) REFERENCES touchpoints(id) ON DELETE CASCADE,
      FOREIGN KEY (business_id)   REFERENCES businesses(id)  ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id              TEXT PRIMARY KEY,
      business_id     TEXT NOT NULL,
      touchpoint_id   TEXT NOT NULL,
      agent_id        TEXT NOT NULL,
      customer_name   TEXT,
      target_language TEXT NOT NULL DEFAULT 'en',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (business_id)   REFERENCES businesses(id)  ON DELETE CASCADE,
      FOREIGN KEY (touchpoint_id) REFERENCES touchpoints(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id)      REFERENCES agents(id)      ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role            TEXT NOT NULL,
      text            TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS leads (
      id                   TEXT PRIMARY KEY,
      business_id          TEXT NOT NULL,
      touchpoint_id        TEXT,
      conversation_id      TEXT,
      agent_id             TEXT,
      name                 TEXT,
      phone                TEXT,
      email                TEXT,
      intent               TEXT,
      qualification_score  INTEGER NOT NULL DEFAULT 0,
      qualification_status TEXT NOT NULL DEFAULT 'pending',
      source               TEXT NOT NULL DEFAULT 'auto',
      notified             INTEGER NOT NULL DEFAULT 0,
      created_at           TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (business_id)   REFERENCES businesses(id)    ON DELETE CASCADE,
      FOREIGN KEY (touchpoint_id) REFERENCES touchpoints(id)   ON DELETE SET NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
      FOREIGN KEY (agent_id)      REFERENCES agents(id)        ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS lead_notifications (
      id          TEXT PRIMARY KEY,
      business_id TEXT NOT NULL,
      lead_id     TEXT NOT NULL UNIQUE,
      read_at     TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (lead_id)     REFERENCES leads(id)      ON DELETE CASCADE
    );

    -- Phase 7 billing: exactly one subscription row per business (the business_id
    -- primary key enforces 1:1). The plan column mirrors businesses.plan but is
    -- the authoritative tier; businesses.plan is kept in sync for legacy readers.
    -- paystack_* columns record the external Paystack objects so lifecycle
    -- webhooks (disable/expire/not_renew) can be attributed to the right tenant
    -- without ever trusting a client-supplied business id.
    CREATE TABLE IF NOT EXISTS subscriptions (
      business_id                 TEXT PRIMARY KEY,
      plan                        TEXT NOT NULL DEFAULT 'Free',
      status                      TEXT NOT NULL DEFAULT 'active',
      paystack_customer_code      TEXT,
      paystack_subscription_code  TEXT,
      paystack_plan_code          TEXT,
      paystack_email_token        TEXT,
      current_period_start        TEXT,
      current_period_end          TEXT,
      cancelled_at                TEXT,
      expires_at                  TEXT,
      last_reference              TEXT,
      created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at                  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (business_id)   REFERENCES businesses(id) ON DELETE CASCADE
    );

    -- One row per server-initialized Paystack transaction. 'reference' is the
    -- idempotency key: a charge.webhook / verify is only applied once per
    -- reference, and a terminal status (success/failed/abandoned) is never
    -- overwritten by a later delivery.
    CREATE TABLE IF NOT EXISTS paystack_transactions (
      reference   TEXT PRIMARY KEY,
      business_id TEXT NOT NULL,
      plan        TEXT NOT NULL,
      currency    TEXT NOT NULL,
      amount      INTEGER NOT NULL,
      plan_code   TEXT,
      status      TEXT NOT NULL DEFAULT 'pending',
      event       TEXT,
      error       TEXT,
      processed_at TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
    );

    -- Paystack webhook delivery log. event_id (the event's own id) is the
    -- idempotency key so duplicate or re-delivered events are acknowledged and
    -- never applied twice.
    CREATE TABLE IF NOT EXISTS webhook_events (
      event_id     TEXT PRIMARY KEY,
      event_type   TEXT NOT NULL,
      business_id  TEXT,
      processed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_agents_business ON agents(business_id);
    CREATE INDEX IF NOT EXISTS idx_touchpoints_business ON touchpoints(business_id);
    CREATE INDEX IF NOT EXISTS idx_touchpoints_agent ON touchpoints(agent_id);
    CREATE INDEX IF NOT EXISTS idx_scans_touchpoint ON touchpoint_scans(touchpoint_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_business ON conversations(business_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_touchpoint ON conversations(touchpoint_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON conversation_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_leads_business ON leads(business_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_conversation ON leads(conversation_id) WHERE conversation_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_lead_notifications_business ON lead_notifications(business_id);

    -- Phase 6 analytics: range queries filter by business + created_at. These
    -- composite indexes make the dashboard's windowed aggregations cheap.
    CREATE INDEX IF NOT EXISTS idx_scans_business_created ON touchpoint_scans(business_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_conversations_business_created ON conversations(business_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_leads_business_created ON leads(business_id, created_at);

    -- Phase 7 billing: subscription/transaction lookups are tenant-scoped by
    -- business_id, and webhook attribution is by the stored Paystack codes.
    CREATE INDEX IF NOT EXISTS idx_paystack_tx_business ON paystack_transactions(business_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_subscription_code ON subscriptions(paystack_subscription_code);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_customer_code ON subscriptions(paystack_customer_code);
  `);

  migratePlanColumn();
  migrateSubscriptions();
  migrateCRMConnections();
}

/**
 * Phase 2 businesses have no persisted subscription/plan state, so agent and
 * touchpoint limits could only be enforced client-side. Phase 3 adds a plan
 * column (defaulting to Free) so limits are enforced server-side per tenant.
 * Billing upgrades remain out of scope; the column simply records the tier.
 */
function migratePlanColumn() {
  const columns = db.prepare('PRAGMA table_info(businesses)').all();
  const hasPlan = columns.some((column) => column.name === 'plan');
  if (!hasPlan) {
    db.exec(`ALTER TABLE businesses ADD COLUMN plan TEXT NOT NULL DEFAULT 'Free'`);
  }
}

/**
 * Phase 7 backfills a subscription row for every business that predates the
 * subscriptions table. The tier is carried over from the existing businesses.plan
 * column so no tenant loses its recorded plan during the migration.
 */
function migrateSubscriptions() {
  const businesses = db.prepare('SELECT id, plan FROM businesses').all();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO subscriptions (business_id, plan, status)
    VALUES (?, ?, 'active')
  `);
  for (const business of businesses) {
    insert.run(business.id, business.plan || 'Free');
  }
}

/**
 * Phase 1 stored CRM connections without a business owner. Phase 2 scopes every
 * connection to the authenticated business (tenant isolation). This migration
 * rebuilds the table with a business_id column. Legacy rows cannot be attributed
 * to any business, so they are dropped rather than left as unowned data.
 */
function migrateCRMConnections() {
  const exists = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'crm_connections'"
  ).get();

  if (!exists) {
    db.exec(`
      CREATE TABLE crm_connections (
        id          TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'connected',
        last_sync   TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (business_id, provider_id),
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
      );
    `);
    return;
  }

  const columns = db.prepare('PRAGMA table_info(crm_connections)').all();
  const hasBusinessId = columns.some((column) => column.name === 'business_id');

  if (!hasBusinessId) {
    db.exec(`
      ALTER TABLE crm_connections RENAME TO crm_connections_legacy;

      CREATE TABLE crm_connections (
        id          TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'connected',
        last_sync   TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (business_id, provider_id),
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
      );

      DROP TABLE crm_connections_legacy;
    `);
  }
}

/**
 * BUSINESS / USER STORAGE
 */

export function createBusiness(name, slug) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO businesses (id, name, slug)
    VALUES (?, ?, ?)
  `).run(id, name, slug);
  createSubscription({ businessId: id, plan: 'Free', status: 'active' });
  return getBusinessById(id);
}

/**
 * Loads a business together with its Phase 7 subscription. The returned `plan`
 * is always the *effective* tier derived from the persisted subscription state
 * (an expired subscription downgrades to Free, a cancelled one keeps its tier
 * until the period ends). Every plan-limit check in the server reads this
 * value, so entitlement follows the subscription, never the client.
 */
export function getBusinessById(id) {
  const business = db.prepare('SELECT id, name, slug, plan, created_at FROM businesses WHERE id = ?').get(id) || null;
  if (!business) return null;
  const subscription = resolveSubscription(getSubscription(business.id));
  business.subscription = subscription;
  business.plan = subscription.plan;
  return business;
}

export function businessSlugExists(slug) {
  return db.prepare('SELECT 1 FROM businesses WHERE slug = ?').get(slug) !== undefined;
}

export function createUser({ id, businessId, email, passwordHash, name, role = 'owner' }) {
  db.prepare(`
    INSERT INTO users (id, business_id, email, password_hash, name, role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, businessId, email, passwordHash, name, role);
}

export function findUserByEmail(email) {
  const user = db.prepare(`
    SELECT id, business_id, email, password_hash, name, role, created_at
    FROM users WHERE email = ?
  `).get(email);
  if (!user) return null;
  return attachBusiness(user);
}

export function findUserById(id) {
  const user = db.prepare(`
    SELECT id, business_id, email, password_hash, name, role, created_at
    FROM users WHERE id = ?
  `).get(id);
  if (!user) return null;
  return attachBusiness(user);
}

function attachBusiness(user) {
  const business = getBusinessById(user.business_id);
  return { ...user, business };
}

/**
 * SESSION STORAGE
 * Sessions are server-side, one row per issued JWT. Logout revokes the row so
 * the token becomes unusable immediately, even before its own expiry.
 */

export function createSession({ id, userId, businessId, ttlSeconds }) {
  const expiresAt = toSqliteDateTime(new Date(Date.now() + ttlSeconds * 1000));
  db.prepare(`
    INSERT INTO sessions (id, user_id, business_id, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(id, userId, businessId, expiresAt);
  return findSession(id);
}

export function findSession(id) {
  return db.prepare(`
    SELECT id, user_id, business_id, created_at, expires_at, revoked_at
    FROM sessions
    WHERE id = ? AND revoked_at IS NULL AND expires_at > datetime('now')
  `).get(id) || null;
}

export function revokeSession(id) {
  const result = db.prepare(`
    UPDATE sessions SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL
  `).run(id);
  return result.changes > 0;
}

/**
 * PHASE 7 — SUBSCRIPTION & BILLING STORAGE
 *
 * One subscription row per business (tenant-scoped by construction: the primary
 * key is the business id, and every write takes a business id derived from the
 * authenticated session or from a Paystack code we stored for that tenant).
 * `plan` + `status` are the persisted entitlement state; everything the UI
 * shows or the server enforces is derived from this row.
 */

const SUBSCRIPTION_COLUMNS = `
  business_id, plan, status, paystack_customer_code, paystack_subscription_code,
  paystack_plan_code, paystack_email_token, current_period_start, current_period_end,
  cancelled_at, expires_at, last_reference, created_at, updated_at
`;

// "YYYY-MM-DD HH:MM:SS" (UTC) -> Date. The format is produced by
// toSqliteDateTime, so the stored value is UTC; re-parse it as UTC to keep
// comparisons timezone-independent.
const parseSqliteDate = (value) => {
  if (!value) return null;
  const normalized = String(value).replace(' ', 'T');
  const parsed = new Date(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const defaultSubscriptionRow = (businessId) => ({
  business_id: businessId,
  plan: 'Free',
  status: 'active',
  paystack_customer_code: null,
  paystack_subscription_code: null,
  paystack_plan_code: null,
  paystack_email_token: null,
  current_period_start: null,
  current_period_end: null,
  cancelled_at: null,
  expires_at: null,
  last_reference: null,
  created_at: null,
  updated_at: null,
});

export function getSubscription(businessId) {
  const row = db.prepare(
    `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE business_id = ?`
  ).get(businessId);
  return row ? { ...defaultSubscriptionRow(businessId), ...row } : defaultSubscriptionRow(businessId);
}

/**
 * Derives the effective entitlement from a subscription row:
 *  - 'expired' always downgrades to Free;
 *  - 'cancelled' / 'not_renewing' keep their tier until the paid period ends,
 *    then they auto-expire to Free on the next read (no scheduler needed);
 *  - every other status keeps the persisted plan.
 * This is the single deterministic rule used by enforcement and the API.
 */
export function resolveSubscription(subscription) {
  const status = subscription.status || 'active';
  const plan = subscription.plan || 'Free';
  let effectiveStatus = status;
  let effectivePlan = plan;

  if (status === 'expired') {
    effectivePlan = 'Free';
  } else if (status === 'cancelled' || status === 'not_renewing') {
    const periodEnd = parseSqliteDate(subscription.current_period_end);
    if (periodEnd && periodEnd.getTime() <= Date.now()) {
      effectiveStatus = 'expired';
      effectivePlan = 'Free';
    }
  }

  return { ...subscription, status: effectiveStatus, plan: effectivePlan };
}

export function createSubscription({ businessId, plan = 'Free', status = 'active' }) {
  db.prepare(`
    INSERT INTO subscriptions (business_id, plan, status)
    VALUES (?, ?, ?)
  `).run(businessId, plan, status);
  return getSubscription(businessId);
}

/**
 * Merges subscription fields for a business (creates the row when needed) and
 * keeps the legacy businesses.plan column in sync. Passing a field as `null`
 * clears it; omitting it leaves it untouched.
 */
export function upsertSubscription(businessId, fields) {
  const allowed = {
    plan: fields.plan,
    status: fields.status,
    paystack_customer_code: fields.paystackCustomerCode === undefined ? undefined : fields.paystackCustomerCode,
    paystack_subscription_code: fields.paystackSubscriptionCode === undefined ? undefined : fields.paystackSubscriptionCode,
    paystack_plan_code: fields.paystackPlanCode === undefined ? undefined : fields.paystackPlanCode,
    paystack_email_token: fields.paystackEmailToken === undefined ? undefined : fields.paystackEmailToken,
    current_period_start: fields.currentPeriodStart === undefined ? undefined : fields.currentPeriodStart,
    current_period_end: fields.currentPeriodEnd === undefined ? undefined : fields.currentPeriodEnd,
    cancelled_at: fields.cancelledAt === undefined ? undefined : fields.cancelledAt,
    expires_at: fields.expiresAt === undefined ? undefined : fields.expiresAt,
    last_reference: fields.lastReference === undefined ? undefined : fields.lastReference,
  };

  const columns = Object.keys(allowed).filter((column) => allowed[column] !== undefined);
  const hasChanges = columns.length > 0;

  if (!hasChanges) {
    const exists = db.prepare('SELECT 1 FROM subscriptions WHERE business_id = ?').get(businessId);
    if (!exists) createSubscription({ businessId });
    return getSubscription(businessId);
  }

  const params = columns.map((column) => allowed[column]);
  db.prepare(`
    INSERT INTO subscriptions (business_id, ${columns.join(', ')})
    VALUES (${['?', ...columns.map(() => '?')].join(', ')})
    ON CONFLICT(business_id) DO UPDATE SET
      ${columns.map((column) => `${column} = excluded.${column}`).join(', ')},
      updated_at = datetime('now')
  `).run(businessId, ...params);

  if (fields.plan !== undefined) {
    db.prepare(`UPDATE businesses SET plan = ?, updated_at = datetime('now') WHERE id = ?`).run(fields.plan, businessId);
  }

  return getSubscription(businessId);
}

export function findSubscriptionBySubscriptionCode(subscriptionCode) {
  return db.prepare(`
    SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions
    WHERE paystack_subscription_code = ?
  `).get(subscriptionCode) || null;
}

export function findSubscriptionByCustomerCode(customerCode) {
  return db.prepare(`
    SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions
    WHERE paystack_customer_code = ?
  `).get(customerCode) || null;
}

/**
 * TRANSACTION STORAGE
 * `reference` is the idempotency key for the whole payment lifecycle. A
 * terminal status is never overwritten, so duplicate webhooks and repeated
 * client verifies are naturally deduplicated.
 */

const PAYSTACK_TX_COLUMNS = `
  reference, business_id, plan, currency, amount, plan_code, status, event,
  error, processed_at, created_at, updated_at
`;

export function createPaystackTransaction({ reference, businessId, plan, currency, amount, planCode }) {
  db.prepare(`
    INSERT INTO paystack_transactions (reference, business_id, plan, currency, amount, plan_code)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(reference, businessId, plan, currency, amount, planCode || null);
  return getPaystackTransaction(reference);
}

export function getPaystackTransaction(reference) {
  return db.prepare(
    `SELECT ${PAYSTACK_TX_COLUMNS} FROM paystack_transactions WHERE reference = ?`
  ).get(reference) || null;
}

/**
 * Finalizes a transaction's lifecycle state. No-op when the transaction is
 * already in a terminal state — this is the second idempotency guard (the
 * first is the webhook_events deduplication).
 */
export function setPaystackTransactionFinalStatus(reference, status, { event = null, error = null, processedAt = null } = {}) {
  const transaction = getPaystackTransaction(reference);
  if (!transaction || transaction.status !== 'pending') return transaction;
  db.prepare(`
    UPDATE paystack_transactions
    SET status = ?, event = ?, error = ?, processed_at = COALESCE(?, datetime('now')), updated_at = datetime('now')
    WHERE reference = ?
  `).run(status, event, error, processedAt, reference);
  return getPaystackTransaction(reference);
}

/**
 * WEBHOOK EVENT STORAGE
 * Every processed webhook is logged by its event id. The INSERT OR IGNORE is
 * the authoritative dedup: if the row already exists the delivery is a
 * duplicate and its side effects are skipped.
 */

export function hasWebhookEvent(eventId) {
  return db.prepare('SELECT 1 FROM webhook_events WHERE event_id = ?').get(eventId) !== undefined;
}

export function recordWebhookEvent({ eventId, eventType, businessId = null }) {
  if (!eventId) return false;
  const result = db.prepare(`
    INSERT OR IGNORE INTO webhook_events (event_id, event_type, business_id)
    VALUES (?, ?, ?)
  `).run(eventId, eventType, businessId);
  return result.changes > 0;
}

/**
 * CRM CONNECTION STORAGE
 * Every connection is owned by a business; other businesses can never see it.
 */

export function saveCRMConnection(businessId, providerId, lastSync) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO crm_connections (id, business_id, provider_id, status, last_sync, updated_at)
    VALUES (?, ?, ?, 'connected', ?, datetime('now'))
    ON CONFLICT(business_id, provider_id) DO UPDATE SET
      status     = 'connected',
      last_sync  = excluded.last_sync,
      updated_at = datetime('now')
  `).run(id, businessId, providerId, lastSync);
}

export function removeCRMConnection(businessId, providerId) {
  const result = db.prepare(
    'DELETE FROM crm_connections WHERE business_id = ? AND provider_id = ?'
  ).run(businessId, providerId);
  return result.changes > 0;
}

export function listCRMConnections(businessId) {
  return db.prepare(`
    SELECT provider_id, status, last_sync FROM crm_connections
    WHERE business_id = ?
    ORDER BY created_at
  `).all(businessId);
}

/**
 * AGENT STORAGE
 * Every agent is owned by a business. All reads and writes are scoped to the
 * authenticated business id — callers must pass the business from the session,
 * never one supplied by the client.
 */

const AGENT_COLUMNS = `
  id, business_id, name, status, industry, voice, description,
  service_catalog, client_profiles, case_library, guidelines, documents,
  leads_generated, conversion_rate, created_at, updated_at
`;

const parseDocuments = (agent) => {
  if (!agent) return null;
  let documents = [];
  try {
    documents = JSON.parse(agent.documents || '[]');
  } catch (err) {
    documents = [];
  }
  return { ...agent, documents: Array.isArray(documents) ? documents : [] };
};

export function createAgent(businessId, data) {
  const id = crypto.randomUUID();
  const documents = JSON.stringify(Array.isArray(data.documents) ? data.documents : []);
  db.prepare(`
    INSERT INTO agents (
      id, business_id, name, status, industry, voice, description,
      service_catalog, client_profiles, case_library, guidelines, documents
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    businessId,
    data.name,
    data.status || 'Active',
    data.industry || 'General',
    data.voice || 'professional',
    data.description ?? null,
    data.serviceCatalog ?? null,
    data.clientProfiles ?? null,
    data.caseLibrary ?? null,
    data.guidelines ?? null,
    documents
  );
  return getAgentById(businessId, id);
}

export function getAgentById(businessId, id) {
  return parseDocuments(db.prepare(`
    SELECT ${AGENT_COLUMNS} FROM agents
    WHERE id = ? AND business_id = ?
  `).get(id, businessId));
}

export function listAgents(businessId) {
  return db.prepare(`
    SELECT ${AGENT_COLUMNS} FROM agents
    WHERE business_id = ?
    ORDER BY datetime(created_at) DESC, created_at DESC
  `).all(businessId).map(parseDocuments);
}

export function countAgents(businessId) {
  return db.prepare('SELECT COUNT(*) AS n FROM agents WHERE business_id = ?').get(businessId).n;
}

export function updateAgent(businessId, id, data) {
  const allowed = {
    name: data.name,
    status: data.status,
    industry: data.industry,
    voice: data.voice,
    description: data.description,
    service_catalog: data.serviceCatalog,
    client_profiles: data.clientProfiles,
    case_library: data.caseLibrary,
    guidelines: data.guidelines,
    documents: Array.isArray(data.documents) ? JSON.stringify(data.documents) : undefined,
  };

  const sets = [];
  const params = [];
  for (const [column, value] of Object.entries(allowed)) {
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    params.push(value);
  }
  if (sets.length === 0) return getAgentById(businessId, id);

  sets.push(`updated_at = datetime('now')`);
  params.push(businessId, id);
  const result = db.prepare(`
    UPDATE agents SET ${sets.join(', ')}
    WHERE business_id = ? AND id = ?
  `).run(...params);
  if (result.changes === 0) return null;
  return getAgentById(businessId, id);
}

export function deleteAgent(businessId, id) {
  const result = db.prepare(
    'DELETE FROM agents WHERE business_id = ? AND id = ?'
  ).run(businessId, id);
  return result.changes > 0;
}

/**
 * TOUCHPOINT STORAGE
 * Touchpoints are owned by a business and must reference an agent that belongs
 * to the same business. tracking_id is unique across the whole database and is
 * generated server-side.
 */

const TOUCHPOINT_COLUMNS = `
  tp.id, tp.business_id, tp.agent_id, tp.name, tp.type, tp.location,
  tp.tracking_id, tp.scans, tp.active, tp.created_at, tp.updated_at,
  a.name AS agent_name, a.status AS agent_status, a.industry AS agent_industry,
  a.voice AS agent_voice, b.name AS business_name
`;

const rowToTouchpoint = (row) => {
  if (!row) return null;
  return {
    ...row,
    active: row.active === 1 || row.active === true,
  };
};

export function createTouchpoint({ businessId, agentId, name, type, location, trackingId }) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO touchpoints (
      id, business_id, agent_id, name, type, location, tracking_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, businessId, agentId, name, type, location, trackingId);
  return getTouchpointById(businessId, id);
}

export function getTouchpointById(businessId, id) {
  return rowToTouchpoint(db.prepare(`
    SELECT ${TOUCHPOINT_COLUMNS} FROM touchpoints tp
    JOIN agents a ON a.id = tp.agent_id
    JOIN businesses b ON b.id = tp.business_id
    WHERE tp.id = ? AND tp.business_id = ?
  `).get(id, businessId));
}

export function listTouchpoints(businessId) {
  return db.prepare(`
    SELECT ${TOUCHPOINT_COLUMNS} FROM touchpoints tp
    JOIN agents a ON a.id = tp.agent_id
    JOIN businesses b ON b.id = tp.business_id
    WHERE tp.business_id = ?
    ORDER BY datetime(tp.created_at) DESC, tp.created_at DESC
  `).all(businessId).map(rowToTouchpoint);
}

export function countTouchpoints(businessId) {
  return db.prepare('SELECT COUNT(*) AS n FROM touchpoints WHERE business_id = ?').get(businessId).n;
}

export function updateTouchpoint(businessId, id, data) {
  const allowed = {
    name: data.name,
    type: data.type,
    location: data.location,
    active: data.active === undefined ? undefined : data.active ? 1 : 0,
    agent_id: data.agentId,
  };

  const sets = [];
  const params = [];
  for (const [column, value] of Object.entries(allowed)) {
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    params.push(value);
  }
  if (sets.length === 0) return getTouchpointById(businessId, id);

  sets.push(`updated_at = datetime('now')`);
  params.push(businessId, id);
  const result = db.prepare(`
    UPDATE touchpoints SET ${sets.join(', ')}
    WHERE business_id = ? AND id = ?
  `).run(...params);
  if (result.changes === 0) return null;
  return getTouchpointById(businessId, id);
}

export function deleteTouchpoint(businessId, id) {
  const result = db.prepare(
    'DELETE FROM touchpoints WHERE business_id = ? AND id = ?'
  ).run(businessId, id);
  return result.changes > 0;
}

export function trackingIdExists(trackingId) {
  return db.prepare('SELECT 1 FROM touchpoints WHERE tracking_id = ?').get(trackingId) !== undefined;
}

/**
 * PHASE 4 — PUBLIC TOUCHPOINT RESOLUTION
 *
 * Resolves a server-generated tracking id to its tenant-owned touchpoint,
 * its connected agent, and the owning business. Used by the public /t route
 * and the unauthenticated chat API. The tracking id (64 bits of CSPRNG
 * entropy) is the only credential a customer holds, so resolution is scoped
 * by tracking id alone — but every record it exposes still belongs to a
 * single tenant.
 */
export function getTouchpointByTrackingId(trackingId) {
  return rowToTouchpoint(db.prepare(`
    SELECT ${TOUCHPOINT_COLUMNS} FROM touchpoints tp
    JOIN agents a ON a.id = tp.agent_id
    JOIN businesses b ON b.id = tp.business_id
    WHERE tp.tracking_id = ?
  `).get(trackingId));
}

/**
 * Records a physical scan of a touchpoint: one durable event row plus the
 * aggregate counter used by the dashboard. Called once per page load of the
 * public /t/:trackingId route, never by the JSON resolution endpoint.
 */
export function recordScan({ touchpointId, businessId, userAgent }) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO touchpoint_scans (id, touchpoint_id, business_id, user_agent)
    VALUES (?, ?, ?, ?)
  `).run(id, touchpointId, businessId, userAgent || null);
  db.prepare(`
    UPDATE touchpoints SET scans = scans + 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(touchpointId);
}

/**
 * CONVERSATION STORAGE
 * A conversation belongs to one business and is anchored to exactly one
 * touchpoint. Public clients can only reach a conversation through the
 * tracking id of that touchpoint; the authenticated dashboard lists them per
 * business. Messages are immutable, ordered rows.
 */

const CONVERSATION_COLUMNS = `
  c.id, c.business_id, c.touchpoint_id, c.agent_id, c.customer_name,
  c.target_language, c.created_at, c.updated_at,
  tp.name AS touchpoint_name, a.name AS agent_name
`;

export function createConversation({ touchpoint, agentId, customerName, targetLanguage }) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO conversations (id, business_id, touchpoint_id, agent_id, customer_name, target_language)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, touchpoint.business_id, touchpoint.id, agentId, customerName || null, targetLanguage || 'en');
  return getConversationById(id);
}

export function getConversationById(id) {
  return db.prepare(`
    SELECT ${CONVERSATION_COLUMNS} FROM conversations c
    JOIN touchpoints tp ON tp.id = c.touchpoint_id
    JOIN agents a ON a.id = c.agent_id
    WHERE c.id = ?
  `).get(id) || null;
}

export function addConversationMessage({ conversationId, role, text }) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO conversation_messages (id, conversation_id, role, text)
    VALUES (?, ?, ?, ?)
  `).run(id, conversationId, role, text);
  db.prepare(`UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`).run(conversationId);
  return db.prepare(`
    SELECT id, conversation_id, role, text, created_at FROM conversation_messages WHERE id = ?
  `).get(id);
}

export function listConversationMessages(conversationId) {
  return db.prepare(`
    SELECT id, role, text, created_at FROM conversation_messages
    WHERE conversation_id = ?
    ORDER BY datetime(created_at), rowid
  `).all(conversationId);
}

/**
 * Lists a business's conversations for the authenticated dashboard, each with
 * its touchpoint, agent, and the latest message for a preview.
 */
export function listConversations(businessId) {
  return db.prepare(`
    SELECT ${CONVERSATION_COLUMNS},
      (SELECT m.text FROM conversation_messages m
       WHERE m.conversation_id = c.id
       ORDER BY datetime(m.created_at), m.rowid DESC LIMIT 1) AS last_message,
      (SELECT COUNT(*) FROM conversation_messages m
       WHERE m.conversation_id = c.id) AS message_count
    FROM conversations c
    JOIN touchpoints tp ON tp.id = c.touchpoint_id
    JOIN agents a ON a.id = c.agent_id
    WHERE c.business_id = ?
    ORDER BY datetime(c.updated_at) DESC, c.updated_at DESC
  `).all(businessId);
}

/**
 * LEAD STORAGE (Phase 5)
 *
 * A lead is a tenant-owned, persistently stored record of a captured prospect.
 * Auto-captured leads are anchored to the conversation they were extracted
 * from (at most one lead per conversation, enforced by the unique
 * conversation_id index); manually logged leads may carry no anchor at all.
 * Every read/write is scoped to the authenticated business id — the caller
 * supplies it from the session, never from the client.
 */

const LEAD_COLUMNS = `
  l.id, l.business_id, l.touchpoint_id, l.conversation_id, l.agent_id,
  l.name, l.phone, l.email, l.intent, l.qualification_score,
  l.qualification_status, l.source, l.notified, l.created_at, l.updated_at,
  tp.name AS touchpoint_name, a.name AS agent_name
`;

const rowToLead = (row) => {
  if (!row) return null;
  return {
    ...row,
    qualification_score: Number(row.qualification_score),
    notified: row.notified === 1 || row.notified === true,
  };
};

export function getLeadById(businessId, id) {
  return rowToLead(db.prepare(`
    SELECT ${LEAD_COLUMNS} FROM leads l
    LEFT JOIN touchpoints tp ON tp.id = l.touchpoint_id
    LEFT JOIN agents a ON a.id = l.agent_id
    WHERE l.id = ? AND l.business_id = ?
  `).get(id, businessId));
}

export function findLeadByConversation(businessId, conversationId) {
  return rowToLead(db.prepare(`
    SELECT ${LEAD_COLUMNS} FROM leads l
    LEFT JOIN touchpoints tp ON tp.id = l.touchpoint_id
    LEFT JOIN agents a ON a.id = l.agent_id
    WHERE l.business_id = ? AND l.conversation_id = ?
  `).get(businessId, conversationId)) || null;
}

export function listLeads(businessId) {
  return db.prepare(`
    SELECT ${LEAD_COLUMNS} FROM leads l
    LEFT JOIN touchpoints tp ON tp.id = l.touchpoint_id
    LEFT JOIN agents a ON a.id = l.agent_id
    WHERE l.business_id = ?
    ORDER BY datetime(l.updated_at) DESC, l.updated_at DESC
  `).all(businessId).map(rowToLead);
}

export function countLeads(businessId) {
  return db.prepare('SELECT COUNT(*) AS n FROM leads WHERE business_id = ?').get(businessId).n;
}

/**
 * Inserts a new lead owned by the business. qualificationScore/Status are
 * normalized by the caller (server-side) before this is reached.
 */
export function createLead({
  businessId,
  touchpointId = null,
  conversationId = null,
  agentId = null,
  name = null,
  phone = null,
  email = null,
  intent = null,
  qualificationScore = 0,
  qualificationStatus = 'pending',
  source = 'auto',
}) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO leads (
      id, business_id, touchpoint_id, conversation_id, agent_id,
      name, phone, email, intent, qualification_score, qualification_status, source
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    businessId,
    touchpointId,
    conversationId,
    agentId,
    name,
    phone,
    email,
    intent,
    qualificationScore,
    qualificationStatus,
    source,
  );
  return getLeadById(businessId, id);
}

export function updateLead(businessId, id, data) {
  const allowed = {
    name: data.name === undefined ? undefined : data.name,
    phone: data.phone === undefined ? undefined : data.phone,
    email: data.email === undefined ? undefined : data.email,
    intent: data.intent === undefined ? undefined : data.intent,
    qualification_score: data.qualificationScore === undefined ? undefined : data.qualificationScore,
    qualification_status: data.qualificationStatus === undefined ? undefined : data.qualificationStatus,
  };

  const sets = [];
  const params = [];
  for (const [column, value] of Object.entries(allowed)) {
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    params.push(value);
  }
  if (sets.length === 0) return getLeadById(businessId, id);

  sets.push(`updated_at = datetime('now')`);
  params.push(businessId, id);
  const result = db.prepare(`
    UPDATE leads SET ${sets.join(', ')}
    WHERE business_id = ? AND id = ?
  `).run(...params);
  if (result.changes === 0) return null;
  return getLeadById(businessId, id);
}

/**
 * LEAD NOTIFICATION STORAGE
 * One notification row per qualified lead (lead_id is UNIQUE), so a lead can
 * never be re-notified. Reading marks all of the business's rows as read;
 * other businesses are untouched because the business_id is always scoped.
 */

export function createLeadNotification({ businessId, leadId }) {
  const exists = db.prepare(
    'SELECT 1 FROM lead_notifications WHERE lead_id = ?'
  ).get(leadId);
  if (exists) return null;

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO lead_notifications (id, business_id, lead_id)
    VALUES (?, ?, ?)
  `).run(id, businessId, leadId);
  db.prepare('UPDATE leads SET notified = 1, updated_at = datetime(\'now\') WHERE id = ?').run(leadId);
  return getLeadNotificationById(id);
}

export function getLeadNotificationById(id) {
  return db.prepare(`
    SELECT n.id, n.business_id, n.lead_id, n.read_at, n.created_at,
      l.name AS lead_name, l.qualification_score, l.qualification_status,
      l.phone, l.email
    FROM lead_notifications n
    JOIN leads l ON l.id = n.lead_id
    WHERE n.id = ?
  `).get(id) || null;
}

export function listLeadNotifications(businessId) {
  return db.prepare(`
    SELECT n.id, n.lead_id, n.read_at, n.created_at,
      l.name AS lead_name, l.qualification_score, l.qualification_status,
      l.phone, l.email
    FROM lead_notifications n
    JOIN leads l ON l.id = n.lead_id
    WHERE n.business_id = ?
    ORDER BY datetime(n.created_at) DESC, n.created_at DESC
  `).all(businessId);
}

export function countUnreadLeadNotifications(businessId) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM lead_notifications
    WHERE business_id = ? AND read_at IS NULL
  `).get(businessId).n;
}

export function markLeadNotificationsRead(businessId) {
  const result = db.prepare(`
    UPDATE lead_notifications SET read_at = datetime('now')
    WHERE business_id = ? AND read_at IS NULL
  `).run(businessId);
  return result.changes;
}

/**
 * PHASE 6 — ANALYTICS STORAGE
 *
 * Analytics are derived on demand from the existing persisted tables
 * (touchpoint_scans, conversations, leads). There is no separate analytics
 * store: every metric reflects the real rows in the tenant's own data. All
 * queries are scoped to a business id supplied by the authenticated session —
 * the caller never passes one from the client.
 *
 * Timestamps are stored as "YYYY-MM-DD HH:MM:SS" UTC, so windowed comparisons
 * are lexicographic over a fixed-width, chronological format.
 */

const ANALYTICS_COUNTS = {
  scans: 'touchpoint_scans',
  conversations: 'conversations',
  leads: 'leads',
};

function analyticsRangeClause(start, end) {
  const clause = [];
  const params = [];
  if (start !== null && start !== undefined) {
    clause.push('created_at >= ?');
    params.push(start);
  }
  if (end !== null && end !== undefined) {
    clause.push('created_at < ?');
    params.push(end);
  }
  return { clause: clause.length ? ` AND ${clause.join(' AND ')}` : '', params };
}

/**
 * Counts rows of one analytics source within an optional [start, end) window.
 * qualifiedOnly restricts leads to the deterministic 'qualified' status.
 */
export function countAnalyticsRows(businessId, source, { start = null, end = null, qualifiedOnly = false } = {}) {
  const { clause, params } = analyticsRangeClause(start, end);
  const qualified = qualifiedOnly ? " AND qualification_status = 'qualified'" : '';
  return db.prepare(
    `SELECT COUNT(*) AS n FROM ${ANALYTICS_COUNTS[source]} WHERE business_id = ?${clause}${qualified}`
  ).get(businessId, ...params).n;
}

/**
 * Counts rows bucketed by a time expression (day or hour). The bucket
 * expression is chosen by the server so the produced labels match the axis it
 * builds; buckets with no rows are simply absent and zero-filled by the caller.
 */
export function analyticsBucketCounts(businessId, source, { start, end, bucketExpr, qualifiedOnly = false }) {
  const { clause, params } = analyticsRangeClause(start, end);
  const qualified = qualifiedOnly ? " AND qualification_status = 'qualified'" : '';
  return db.prepare(
    `SELECT ${bucketExpr} AS bucket, COUNT(*) AS n
     FROM ${ANALYTICS_COUNTS[source]}
     WHERE business_id = ?${clause}${qualified}
     GROUP BY bucket`
  ).all(businessId, ...params).map((row) => ({ bucket: row.bucket, count: row.n }));
}

/**
 * Counts rows grouped by a dimension column (touchpoint_id or agent_id) within
 * an optional [start, end) window. Dimension names come from server code only.
 */
export function analyticsGroupedCounts(businessId, source, { start = null, end = null, groupBy, qualifiedOnly = false } = {}) {
  const { clause, params } = analyticsRangeClause(start, end);
  const qualified = qualifiedOnly ? " AND qualification_status = 'qualified'" : '';
  return db.prepare(
    `SELECT ${groupBy} AS id, COUNT(*) AS n
     FROM ${ANALYTICS_COUNTS[source]}
     WHERE business_id = ?${clause}${qualified}
     GROUP BY ${groupBy}`
  ).all(businessId, ...params).map((row) => ({ id: row.id, count: row.n }));
}
