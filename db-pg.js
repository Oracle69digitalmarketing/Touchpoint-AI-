
import pg from 'pg';
import crypto from 'node:crypto';
import 'dotenv/config';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // Keep shared/idle connections alive and bound the wait for a free slot, so
  // a stale socket (e.g. a provider-side idle reset) degrades into a fast,
  // retryable error instead of silently wedging the request queue.
  keepAlive: true,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10,
});

/**
 * Live database round-trip used by /v1/health.
 */
export async function pingDatabase() {
  try {
    const res = await pool.query('SELECT 1 AS ok');
    return res.rows[0].ok === 1;
  } catch (err) {
    console.error('[DB-PG] Ping failed:', err.message);
    return false;
  }
}

/**
 * Closes the pool.
 */
export async function closeDatabase() {
  await pool.end();
}

/**
 * PostgreSQL handles TIMESTAMPTZ natively. 
 * This helper ensures JS Dates are passed correctly if needed, 
 * though pg-types handles most conversions.
 */
export const toSqlDateTime = (date) => date.toISOString();

/**
 * BUSINESS / USER STORAGE
 */

export async function createBusiness(name, slug) {
  const id = crypto.randomUUID();
  await pool.query(
    'INSERT INTO businesses (id, name, slug) VALUES ($1, $2, $3)',
    [id, name, slug]
  );
  await createSubscription({ businessId: id, plan: 'Free', status: 'active' });
  return getBusinessById(id);
}

export async function getBusinessById(id) {
  const res = await pool.query(
    'SELECT id, name, slug, plan, whatsapp, phone, email, booking_url, created_at FROM businesses WHERE id = $1',
    [id]
  );
  const business = res.rows[0] || null;
  if (!business) return null;
  
  const subscription = await resolveSubscription(await getSubscription(business.id));
  business.subscription = subscription;
  business.plan = subscription.plan;
  return business;
}

export async function businessSlugExists(slug) {
  const res = await pool.query('SELECT 1 FROM businesses WHERE slug = $1', [slug]);
  return res.rowCount > 0;
}

/**
 * Handoff settings are stored on the business row and are server-authoritative:
 * the agent may only offer channels that were explicitly persisted here.
 */
export async function updateBusinessHandoff(businessId, fields) {
  const allowed = {
    whatsapp: fields.whatsapp,
    phone: fields.phone,
    email: fields.email,
    booking_url: fields.bookingUrl,
  };

  const sets = [];
  const params = [];
  for (const [col, val] of Object.entries(allowed)) {
    if (val === undefined) continue;
    sets.push(`${col} = $${params.length + 1}`);
    params.push(val);
  }
  if (sets.length === 0) return getBusinessById(businessId);

  params.push(businessId);
  await pool.query(`UPDATE businesses SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${params.length}`, params);
  return getBusinessById(businessId);
}

export async function createUser({ id, businessId, email, passwordHash, name, role = 'owner', emailVerified = false, verificationToken = null, verificationExpiresAt = null }) {
  await pool.query(
    'INSERT INTO users (id, business_id, email, password_hash, name, role, email_verified, verification_token, verification_expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [id, businessId, email, passwordHash, name, role, emailVerified, verificationToken, verificationExpiresAt]
  );
}

export async function findUserByEmail(email) {
  const res = await pool.query(
    'SELECT id, business_id, email, password_hash, name, role, email_verified, verification_token, verification_expires_at, created_at FROM users WHERE email = $1',
    [email]
  );
  const user = res.rows[0];
  if (!user) return null;
  return attachBusiness(user);
}

export async function findUserById(id) {
  const res = await pool.query(
    'SELECT id, business_id, email, password_hash, name, role, created_at FROM users WHERE id = $1',
    [id]
  );
  const user = res.rows[0];
  if (!user) return null;
  return attachBusiness(user);
}

async function attachBusiness(user) {
  const business = await getBusinessById(user.business_id);
  return { ...user, business };
}

/**
 * SESSION STORAGE
 */

export async function createSession({ id, userId, businessId, ttlSeconds }) {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await pool.query(
    'INSERT INTO sessions (id, user_id, business_id, expires_at) VALUES ($1, $2, $3, $4)',
    [id, userId, businessId, expiresAt]
  );
  return findSession(id);
}

export async function findSession(id) {
  const res = await pool.query(
    'SELECT id, user_id, business_id, created_at, expires_at, revoked_at FROM sessions WHERE id = $1 AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP',
    [id]
  );
  return res.rows[0] || null;
}

export async function revokeSession(id) {
  const res = await pool.query(
    'UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1 AND revoked_at IS NULL',
    [id]
  );
  return res.rowCount > 0;
}

/**
 * SUBSCRIPTION & BILLING STORAGE
 */

const SUBSCRIPTION_COLUMNS = `
  business_id, plan, status, paystack_customer_code, paystack_subscription_code,
  paystack_plan_code, paystack_email_token, current_period_start, current_period_end,
  cancelled_at, expires_at, last_reference, created_at, updated_at
`;

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

export async function getSubscription(businessId) {
  const res = await pool.query(
    `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE business_id = $1`,
    [businessId]
  );
  const row = res.rows[0];
  return row ? { ...defaultSubscriptionRow(businessId), ...row } : defaultSubscriptionRow(businessId);
}

export async function resolveSubscription(subscription) {
  const status = subscription.status || 'active';
  const plan = subscription.plan || 'Free';
  let effectiveStatus = status;
  let effectivePlan = plan;

  if (status === 'expired') {
    effectivePlan = 'Free';
  } else if (status === 'cancelled' || status === 'not_renewing') {
    const periodEnd = subscription.current_period_end ? new Date(subscription.current_period_end) : null;
    if (periodEnd && periodEnd.getTime() <= Date.now()) {
      effectiveStatus = 'expired';
      effectivePlan = 'Free';
    }
  }

  return { ...subscription, status: effectiveStatus, plan: effectivePlan };
}

export async function createSubscription({ businessId, plan = 'Free', status = 'active' }) {
  await pool.query(
    'INSERT INTO subscriptions (business_id, plan, status) VALUES ($1, $2, $3)',
    [businessId, plan, status]
  );
  return getSubscription(businessId);
}

export async function upsertSubscription(businessId, fields) {
  const allowed = {
    plan: fields.plan,
    status: fields.status,
    paystack_customer_code: fields.paystackCustomerCode,
    paystack_subscription_code: fields.paystackSubscriptionCode,
    paystack_plan_code: fields.paystackPlanCode,
    paystack_email_token: fields.paystackEmailToken,
    current_period_start: fields.currentPeriodStart,
    current_period_end: fields.currentPeriodEnd,
    cancelled_at: fields.cancelledAt,
    expires_at: fields.expiresAt,
    last_reference: fields.lastReference,
  };

  const columns = Object.keys(allowed).filter((col) => allowed[col] !== undefined);
  if (columns.length === 0) {
    const exists = await pool.query('SELECT 1 FROM subscriptions WHERE business_id = $1', [businessId]);
    if (exists.rowCount === 0) await createSubscription({ businessId });
    return getSubscription(businessId);
  }

  const values = columns.map((col) => allowed[col]);
  const placeholders = columns.map((_, i) => `$${i + 2}`).join(', ');
  const sets = columns.map((col, i) => `${col} = EXCLUDED.${col}`).join(', ');

  await pool.query(`
    INSERT INTO subscriptions (business_id, ${columns.join(', ')})
    VALUES ($1, ${placeholders})
    ON CONFLICT(business_id) DO UPDATE SET
      ${sets},
      updated_at = CURRENT_TIMESTAMP
  `, [businessId, ...values]);

  if (fields.plan !== undefined) {
    await pool.query('UPDATE businesses SET plan = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [fields.plan, businessId]);
  }

  return getSubscription(businessId);
}

export async function findSubscriptionBySubscriptionCode(subscriptionCode) {
  const res = await pool.query(
    `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE paystack_subscription_code = $1`,
    [subscriptionCode]
  );
  return res.rows[0] || null;
}

export async function findSubscriptionByCustomerCode(customerCode) {
  const res = await pool.query(
    `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE paystack_customer_code = $1`,
    [customerCode]
  );
  return res.rows[0] || null;
}

/**
 * TRANSACTION STORAGE
 */

const PAYSTACK_TX_COLUMNS = `
  reference, business_id, plan, currency, amount, plan_code, status, event,
  error, processed_at, created_at, updated_at
`;

export async function createPaystackTransaction({ reference, businessId, plan, currency, amount, planCode }) {
  await pool.query(
    'INSERT INTO paystack_transactions (reference, business_id, plan, currency, amount, plan_code) VALUES ($1, $2, $3, $4, $5, $6)',
    [reference, businessId, plan, currency, amount, planCode || null]
  );
  return getPaystackTransaction(reference);
}

export async function getPaystackTransaction(reference) {
  const res = await pool.query(
    `SELECT ${PAYSTACK_TX_COLUMNS} FROM paystack_transactions WHERE reference = $1`,
    [reference]
  );
  return res.rows[0] || null;
}

export async function setPaystackTransactionFinalStatus(reference, status, { event = null, error = null, processedAt = null } = {}) {
  const transaction = await getPaystackTransaction(reference);
  if (!transaction || transaction.status !== 'pending') return transaction;
  
  await pool.query(`
    UPDATE paystack_transactions
    SET status = $1, event = $2, error = $3, processed_at = COALESCE($4, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
    WHERE reference = $5
  `, [status, event, error, processedAt, reference]);
  
  return getPaystackTransaction(reference);
}

/**
 * WEBHOOK EVENT STORAGE
 */

export async function hasWebhookEvent(eventId) {
  const res = await pool.query('SELECT 1 FROM webhook_events WHERE event_id = $1', [eventId]);
  return res.rowCount > 0;
}

export async function recordWebhookEvent({ eventId, eventType, businessId = null }) {
  if (!eventId) return false;
  const res = await pool.query(
    'INSERT INTO webhook_events (event_id, event_type, business_id) VALUES ($1, $2, $3) ON CONFLICT(event_id) DO NOTHING',
    [eventId, eventType, businessId]
  );
  return res.rowCount > 0;
}

/**
 * CRM CONNECTION STORAGE
 */

export async function saveCRMConnection(businessId, providerId, lastSync) {
  const id = crypto.randomUUID();
  await pool.query(`
    INSERT INTO crm_connections (id, business_id, provider_id, status, last_sync)
    VALUES ($1, $2, $3, 'connected', $4)
    ON CONFLICT(business_id, provider_id) DO UPDATE SET
      status = 'connected',
      last_sync = EXCLUDED.last_sync,
      updated_at = CURRENT_TIMESTAMP
  `, [id, businessId, providerId, lastSync]);
}

export async function removeCRMConnection(businessId, providerId) {
  const res = await pool.query(
    'DELETE FROM crm_connections WHERE business_id = $1 AND provider_id = $2',
    [businessId, providerId]
  );
  return res.rowCount > 0;
}

export async function listCRMConnections(businessId) {
  const res = await pool.query(
    'SELECT provider_id, status, last_sync FROM crm_connections WHERE business_id = $1 ORDER BY created_at',
    [businessId]
  );
  return res.rows;
}

/**
 * AGENT STORAGE
 */

const AGENT_COLUMNS = `
  id, business_id, name, status, industry, voice, description,
  service_catalog, client_profiles, case_library, guidelines, documents,
  leads_generated, conversion_rate, created_at, updated_at
`;

export async function createAgent(businessId, data) {
  const id = crypto.randomUUID();
  const documents = Array.isArray(data.documents) ? JSON.stringify(data.documents) : '[]';
  await pool.query(`
    INSERT INTO agents (
      id, business_id, name, status, industry, voice, description,
      service_catalog, client_profiles, case_library, guidelines, documents
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  `, [
    id, businessId, data.name, data.status || 'Active', data.industry || 'General',
    data.voice || 'professional', data.description || null, data.serviceCatalog || null,
    data.clientProfiles || null, data.caseLibrary || null, data.guidelines || null, documents
  ]);
  return getAgentById(businessId, id);
}

export async function getAgentById(businessId, id) {
  const res = await pool.query(
    `SELECT ${AGENT_COLUMNS} FROM agents WHERE id = $1 AND business_id = $2`,
    [id, businessId]
  );
  return res.rows[0] || null;
}

export async function listAgents(businessId) {
  const res = await pool.query(
    `SELECT ${AGENT_COLUMNS} FROM agents WHERE business_id = $1 ORDER BY created_at DESC`,
    [businessId]
  );
  return res.rows;
}

export async function countAgents(businessId) {
  const res = await pool.query('SELECT COUNT(*) AS n FROM agents WHERE business_id = $1', [businessId]);
  return parseInt(res.rows[0].n, 10);
}

export async function updateAgent(businessId, id, data) {
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
  for (const [col, val] of Object.entries(allowed)) {
    if (val === undefined) continue;
    sets.push(`${col} = $${params.length + 1}`);
    params.push(val);
  }
  if (sets.length === 0) return getAgentById(businessId, id);

  params.push(businessId, id);
  const res = await pool.query(`
    UPDATE agents SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
    WHERE business_id = $${params.length - 1} AND id = $${params.length}
  `, params);
  
  if (res.rowCount === 0) return null;
  return getAgentById(businessId, id);
}

export async function deleteAgent(businessId, id) {
  const res = await pool.query('DELETE FROM agents WHERE business_id = $1 AND id = $2', [businessId, id]);
  return res.rowCount > 0;
}

/**
 * TOUCHPOINT STORAGE
 */

const TOUCHPOINT_COLUMNS = `
  tp.id, tp.business_id, tp.agent_id, tp.name, tp.type, tp.location,
  tp.tracking_id, tp.scans, tp.active, tp.created_at, tp.updated_at,
  a.name AS agent_name, a.status AS agent_status, a.industry AS agent_industry,
  a.voice AS agent_voice, b.name AS business_name
`;

export async function createTouchpoint({ businessId, agentId, name, type, location, trackingId }) {
  const id = crypto.randomUUID();
  await pool.query(`
    INSERT INTO touchpoints (id, business_id, agent_id, name, type, location, tracking_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [id, businessId, agentId, name, type, location, trackingId]);
  return getTouchpointById(businessId, id);
}

export async function getTouchpointById(businessId, id) {
  const res = await pool.query(`
    SELECT ${TOUCHPOINT_COLUMNS} FROM touchpoints tp
    JOIN agents a ON a.id = tp.agent_id
    JOIN businesses b ON b.id = tp.business_id
    WHERE tp.id = $1 AND tp.business_id = $2
  `, [id, businessId]);
  return res.rows[0] || null;
}

export async function listTouchpoints(businessId) {
  const res = await pool.query(`
    SELECT ${TOUCHPOINT_COLUMNS} FROM touchpoints tp
    JOIN agents a ON a.id = tp.agent_id
    JOIN businesses b ON b.id = tp.business_id
    WHERE tp.business_id = $1 ORDER BY tp.created_at DESC
  `, [businessId]);
  return res.rows;
}

export async function countTouchpoints(businessId) {
  const res = await pool.query('SELECT COUNT(*) AS n FROM touchpoints WHERE business_id = $1', [businessId]);
  return parseInt(res.rows[0].n, 10);
}

export async function updateTouchpoint(businessId, id, data) {
  const allowed = {
    name: data.name,
    type: data.type,
    location: data.location,
    active: data.active,
    agent_id: data.agentId,
  };

  const sets = [];
  const params = [];
  for (const [col, val] of Object.entries(allowed)) {
    if (val === undefined) continue;
    sets.push(`${col} = $${params.length + 1}`);
    params.push(val);
  }
  if (sets.length === 0) return getTouchpointById(businessId, id);

  params.push(businessId, id);
  const res = await pool.query(`
    UPDATE touchpoints SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
    WHERE business_id = $${params.length - 1} AND id = $${params.length}
  `, params);

  if (res.rowCount === 0) return null;
  return getTouchpointById(businessId, id);
}

export async function deleteTouchpoint(businessId, id) {
  const res = await pool.query('DELETE FROM touchpoints WHERE business_id = $1 AND id = $2', [businessId, id]);
  return res.rowCount > 0;
}

export async function trackingIdExists(trackingId) {
  const res = await pool.query('SELECT 1 FROM touchpoints WHERE tracking_id = $1', [trackingId]);
  return res.rowCount > 0;
}

export async function getTouchpointByTrackingId(trackingId) {
  const res = await pool.query(`
    SELECT ${TOUCHPOINT_COLUMNS} FROM touchpoints tp
    JOIN agents a ON a.id = tp.agent_id
    JOIN businesses b ON b.id = tp.business_id
    WHERE tp.tracking_id = $1
  `, [trackingId]);
  return res.rows[0] || null;
}

export async function recordScan({ touchpointId, businessId, userAgent }) {
  const id = crypto.randomUUID();
  // Using a transaction to ensure both operations succeed or fail together
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO touchpoint_scans (id, touchpoint_id, business_id, user_agent) VALUES ($1, $2, $3, $4)',
      [id, touchpointId, businessId, userAgent || null]
    );
    await client.query(
      'UPDATE touchpoints SET scans = scans + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [touchpointId]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * CONVERSATION STORAGE
 */

const CONVERSATION_COLUMNS = `
  c.id, c.business_id, c.touchpoint_id, c.agent_id, c.customer_name,
  c.target_language, c.channel, c.stage, c.intent, c.customer_need,
  c.recommended_product_id, c.buying_signal, c.objection, c.contact_declined,
  c.questions_asked, c.captured_lead_fields, c.next_best_action,
  c.created_at, c.updated_at,
  tp.name AS touchpoint_name, a.name AS agent_name
`;

function decodeSalesState(conversation) {
  return {
    stage: conversation.stage || 'engage',
    intent: conversation.intent || null,
    customerNeed: conversation.customer_need || null,
    recommendedProductId: conversation.recommended_product_id || null,
    buyingSignal: !!conversation.buying_signal,
    objection: conversation.objection || null,
    contactDeclined: !!conversation.contact_declined,
    questionsAsked: Array.isArray(conversation.questions_asked) ? conversation.questions_asked : [],
    capturedLeadFields: conversation.captured_lead_fields && typeof conversation.captured_lead_fields === 'object'
      ? conversation.captured_lead_fields
      : {},
    nextBestAction: conversation.next_best_action || null,
  };
}

export async function createConversation({ touchpoint = null, businessId = null, touchpointId = null, agentId, customerName = null, targetLanguage = 'en', channel = 'web' }) {
  const id = crypto.randomUUID();
  const biz = touchpoint ? touchpoint.business_id : businessId;
  if (!biz) throw new Error('createConversation requires a business');
  const tp = touchpoint ? touchpoint.id : touchpointId;
  await pool.query(
    `INSERT INTO conversations (id, business_id, touchpoint_id, agent_id, customer_name, target_language, channel)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, biz, tp || null, agentId, customerName || null, targetLanguage || 'en', channel || 'web']
  );
  return getConversationById(id);
}

export async function getConversationById(id) {
  const res = await pool.query(`
    SELECT ${CONVERSATION_COLUMNS} FROM conversations c
    LEFT JOIN touchpoints tp ON tp.id = c.touchpoint_id
    JOIN agents a ON a.id = c.agent_id
    WHERE c.id = $1
  `, [id]);
  const conversation = res.rows[0] || null;
  if (!conversation) return null;
  return { ...conversation, salesState: decodeSalesState(conversation) };
}

export async function addConversationMessage({ conversationId, role, text }) {
  const id = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO conversation_messages (id, conversation_id, role, text) VALUES ($1, $2, $3, $4)',
      [id, conversationId, role, text]
    );
    await client.query('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [conversationId]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  
  const res = await pool.query(
    'SELECT id, conversation_id, role, text, created_at FROM conversation_messages WHERE id = $1',
    [id]
  );
  return res.rows[0];
}

export async function listConversationMessages(conversationId) {
  const res = await pool.query(
    'SELECT id, role, text, created_at FROM conversation_messages WHERE conversation_id = $1 ORDER BY seq',
    [conversationId]
  );
  return res.rows;
}

export async function listConversations(businessId) {
  const res = await pool.query(`
    SELECT ${CONVERSATION_COLUMNS},
      (SELECT m.text FROM conversation_messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.seq DESC LIMIT 1) AS last_message,
      (SELECT COUNT(*)::int FROM conversation_messages m
       WHERE m.conversation_id = c.id) AS message_count
    FROM conversations c
    LEFT JOIN touchpoints tp ON tp.id = c.touchpoint_id
    JOIN agents a ON a.id = c.agent_id
    WHERE c.business_id = $1
    ORDER BY c.updated_at DESC
  `, [businessId]);
  return res.rows.map((conversation) => ({ ...conversation, salesState: decodeSalesState(conversation) }));
}

/**
 * STRUCTURED PRODUCT/SERVICE CATALOG (Batch 2)
 *
 * Authoritative when any rows exist for a business. The legacy free-text
 * agents.service_catalog remains the compatibility fallback until structured
 * products are configured.
 */

const PRODUCT_COLUMNS = `
  id, business_id, name, description, category, price, currency, status,
  bookable, metadata, created_at, updated_at
`;

const parsePrice = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export async function createProduct(businessId, data) {
  const id = crypto.randomUUID();
  await pool.query(`
    INSERT INTO products (
      id, business_id, name, description, category, price, currency, status, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [
    id, businessId, data.name, data.description || null, data.category || null,
    data.price, data.currency || 'NGN', data.status || 'active',
    data.metadata && typeof data.metadata === 'object'
      ? JSON.stringify(data.metadata)
      : '{}',
  ]);
  return getProductById(businessId, id);
}

export async function getProductById(businessId, id) {
  const res = await pool.query(
    `SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1 AND business_id = $2`,
    [id, businessId]
  );
  const product = res.rows[0] || null;
  if (!product) return null;
  product.price = parsePrice(product.price);
  return product;
}

export async function listProducts(businessId, { status = null } = {}) {
  let sql = `SELECT ${PRODUCT_COLUMNS} FROM products WHERE business_id = $1`;
  const params = [businessId];
  if (status) {
    params.push(status);
    sql += ` AND status = $${params.length}`;
  }
  sql += ' ORDER BY created_at ASC';
  const res = await pool.query(sql, params);
  return res.rows.map((product) => ({ ...product, price: parsePrice(product.price) }));
}

export async function countProducts(businessId) {
  const res = await pool.query('SELECT COUNT(*) AS n FROM products WHERE business_id = $1', [businessId]);
  return parseInt(res.rows[0].n, 10);
}

export async function updateProduct(businessId, id, data) {
  const allowed = {
    name: data.name,
    description: data.description,
    category: data.category,
    price: data.price,
    currency: data.currency,
    status: data.status,
    bookable: data.bookable === undefined ? undefined : !!data.bookable,
    metadata: data.metadata && typeof data.metadata === 'object'
      ? JSON.stringify(data.metadata)
      : undefined,
  };

  const sets = [];
  const params = [];
  for (const [col, val] of Object.entries(allowed)) {
    if (val === undefined) continue;
    sets.push(`${col} = $${params.length + 1}`);
    params.push(val);
  }
  if (sets.length === 0) return getProductById(businessId, id);

  params.push(businessId, id);
  const res = await pool.query(`
    UPDATE products SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
    WHERE business_id = $${params.length - 1} AND id = $${params.length}
  `, params);

  if (res.rowCount === 0) return null;
  return getProductById(businessId, id);
}

export async function deleteProduct(businessId, id) {
  const res = await pool.query('DELETE FROM products WHERE business_id = $1 AND id = $2', [businessId, id]);
  return res.rowCount > 0;
}

/**
 * PERSISTENT SALES CONVERSATION STATE (Batch 2)
 *
 * The server owns stage/intent/next-best-action derivation and stores the
 * result here so resumed conversations never depend on the LLM remembering
 * them from the transcript.
 */
export async function updateConversationSalesState(conversationId, state) {
  await pool.query(`
    UPDATE conversations SET
      stage = $1,
      intent = $2,
      customer_need = $3,
      recommended_product_id = $4,
      buying_signal = $5,
      objection = $6,
      contact_declined = $7,
      questions_asked = $8,
      captured_lead_fields = $9,
      next_best_action = $10,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $11
  `, [
    state.stage || 'engage',
    state.intent || null,
    state.customerNeed || null,
    state.recommendedProductId || null,
    !!state.buyingSignal,
    state.objection || null,
    state.contactDeclined === true,
    JSON.stringify(Array.isArray(state.questionsAsked) ? state.questionsAsked : []),
    JSON.stringify(state.capturedLeadFields && typeof state.capturedLeadFields === 'object' ? state.capturedLeadFields : {}),
    state.nextBestAction || null,
    conversationId,
  ]);
  return getConversationById(conversationId);
}

/**
 * LEAD STORAGE
 */

const LEAD_COLUMNS = `
  l.id, l.business_id, l.touchpoint_id, l.conversation_id, l.agent_id,
  l.name, l.phone, l.email, l.intent, l.qualification_score,
  l.qualification_status, l.source, l.notified, l.crm_status, l.assigned_user_id,
  l.created_at, l.updated_at,
  tp.name AS touchpoint_name, a.name AS agent_name
`;

export async function getLeadById(businessId, id) {
  const res = await pool.query(`
    SELECT ${LEAD_COLUMNS} FROM leads l
    LEFT JOIN touchpoints tp ON tp.id = l.touchpoint_id
    LEFT JOIN agents a ON a.id = l.agent_id
    WHERE l.id = $1 AND l.business_id = $2
  `, [id, businessId]);
  return res.rows[0] || null;
}

export async function findLeadByConversation(businessId, conversationId) {
  const res = await pool.query(`
    SELECT ${LEAD_COLUMNS} FROM leads l
    LEFT JOIN touchpoints tp ON tp.id = l.touchpoint_id
    LEFT JOIN agents a ON a.id = l.agent_id
    WHERE l.business_id = $1 AND l.conversation_id = $2
  `, [businessId, conversationId]);
  return res.rows[0] || null;
}

export async function listLeads(businessId) {
  const res = await pool.query(`
    SELECT ${LEAD_COLUMNS} FROM leads l
    LEFT JOIN touchpoints tp ON tp.id = l.touchpoint_id
    LEFT JOIN agents a ON a.id = l.agent_id
    WHERE l.business_id = $1 ORDER BY l.updated_at DESC
  `, [businessId]);
  return res.rows;
}

export async function countLeads(businessId) {
  const res = await pool.query('SELECT COUNT(*) AS n FROM leads WHERE business_id = $1', [businessId]);
  return parseInt(res.rows[0].n, 10);
}

export async function createLead({
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
  await pool.query(`
    INSERT INTO leads (
      id, business_id, touchpoint_id, conversation_id, agent_id,
      name, phone, email, intent, qualification_score, qualification_status, source
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  `, [
    id, businessId, touchpointId, conversationId, agentId, name, phone, email,
    intent, qualificationScore, qualificationStatus, source
  ]);
  return getLeadById(businessId, id);
}

export async function updateLead(businessId, id, data) {
  const allowed = {
    name: data.name,
    phone: data.phone,
    email: data.email,
    intent: data.intent,
    qualification_score: data.qualificationScore,
    qualification_status: data.qualificationStatus,
  };

  const sets = [];
  const params = [];
  for (const [col, val] of Object.entries(allowed)) {
    if (val === undefined) continue;
    sets.push(`${col} = $${params.length + 1}`);
    params.push(val);
  }
  if (sets.length === 0) return getLeadById(businessId, id);

  params.push(businessId, id);
  const res = await pool.query(`
    UPDATE leads SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
    WHERE business_id = $${params.length - 1} AND id = $${params.length}
  `, params);
  
  if (res.rowCount === 0) return null;
  return getLeadById(businessId, id);
}

/**
 * PHASE 13F CRM PERSISTENCE
 *
 * Operator-controlled lead CRM state, stored separately from the AI-driven
 * qualification state (qualification_status/score) and the sales conversation
 * stage. Tenant ownership on every operation is anchored to the authenticated
 * business id supplied by the caller (from the session, never the client body).
 */

export const CRM_STATUSES = [
  'new', 'contacted', 'qualified', 'opportunity',
  'customer', 'unqualified', 'lost', 'do_not_contact',
];

export const CRM_NOTE_SOURCES = ['human', 'ai'];

/**
 * Sets a lead's operator-controlled CRM status. Returns the updated lead, or
 * null when the lead does not belong to the business. Throws when the status
 * is not one of the approved values.
 */
export async function setLeadCrmStatus(businessId, leadId, status) {
  if (!CRM_STATUSES.includes(status)) {
    throw new Error(`crmStatus must be one of: ${CRM_STATUSES.join(', ')}`);
  }
  const res = await pool.query(
    `UPDATE leads SET crm_status = $1, updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $2 AND id = $3`,
    [status, businessId, leadId]
  );
  if (res.rowCount === 0) return null;
  return getLeadById(businessId, leadId);
}

/**
 * Assigns (or, with a null userId, unassigns) a workspace user to a lead.
 * The assigned user MUST belong to the authenticated business; a user from any
 * other business is rejected. The caller must always supply the business id
 * from the authenticated session — a client-supplied business id is never
 * trusted. Returns the updated lead, or null when the lead does not belong to
 * the business.
 */
export async function assignLeadUser(businessId, leadId, userId) {
  if (userId !== null && userId !== undefined) {
    const user = await pool.query(
      'SELECT 1 FROM users WHERE id = $1 AND business_id = $2',
      [userId, businessId]
    );
    if (user.rowCount === 0) {
      throw new Error('The assigned user does not belong to this business');
    }
  }
  const res = await pool.query(
    `UPDATE leads SET assigned_user_id = $1, updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $2 AND id = $3`,
    [userId === undefined ? null : userId, businessId, leadId]
  );
  if (res.rowCount === 0) return null;
  return getLeadById(businessId, leadId);
}

/**
 * Creates a CRM note for a lead. Tenant ownership is checked on BOTH the lead
 * and the optional author: the lead must belong to the business and, when an
 * author is supplied, that user must belong to the same business. `source`
 * distinguishes human-authored notes from AI notes; nothing generates AI notes
 * in this phase, but the model is ready for them.
 */
export async function createCrmNote({ businessId, leadId, authorUserId = null, body, source }) {
  if (typeof body !== 'string' || !body.trim()) {
    throw new Error('Note body must be a non-empty string');
  }
  if (!CRM_NOTE_SOURCES.includes(source)) {
    throw new Error(`Note source must be one of: ${CRM_NOTE_SOURCES.join(', ')}`);
  }
  const lead = await pool.query(
    'SELECT 1 FROM leads WHERE id = $1 AND business_id = $2',
    [leadId, businessId]
  );
  if (lead.rowCount === 0) {
    throw new Error('The lead does not belong to this business');
  }
  if (authorUserId !== null && authorUserId !== undefined) {
    const author = await pool.query(
      'SELECT 1 FROM users WHERE id = $1 AND business_id = $2',
      [authorUserId, businessId]
    );
    if (author.rowCount === 0) {
      throw new Error('The note author does not belong to this business');
    }
  }
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO crm_notes (id, business_id, lead_id, author_user_id, body, source)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, businessId, leadId, authorUserId === undefined ? null : authorUserId, body, source]
  );
  const res = await pool.query(
    'SELECT id, business_id, lead_id, author_user_id, body, source, created_at, updated_at FROM crm_notes WHERE id = $1',
    [id]
  );
  return res.rows[0];
}

/**
 * Lists a lead's CRM notes, newest first. Scoped to the business: a lead from
 * another business yields an empty result, never leaked rows.
 */
export async function listCrmNotes(businessId, leadId) {
  const res = await pool.query(
    `SELECT id, business_id, lead_id, author_user_id, body, source, created_at, updated_at
     FROM crm_notes
     WHERE business_id = $1 AND lead_id = $2
     ORDER BY created_at DESC`,
    [businessId, leadId]
  );
  return res.rows;
}

/**
 * PHASE 13F CRM READ MODELS (derived, read-only)
 *
 * Enriched lead rows: the persisted lead joined to its 1:1 conversation's
 * sales intelligence. Conversation count, first/last interaction and every
 * intelligence field are derived on read — nothing is denormalized onto
 * `leads`.
 */

const CRM_LEAD_COLUMNS = `
  l.id, l.business_id, l.touchpoint_id, l.conversation_id, l.agent_id,
  l.name, l.phone, l.email, l.intent, l.qualification_score,
  l.qualification_status, l.source, l.notified, l.crm_status, l.assigned_user_id,
  l.created_at, l.updated_at,
  tp.name AS touchpoint_name, a.name AS agent_name,
  c.stage AS sales_stage, c.intent AS conversation_intent, c.customer_need,
  c.buying_signal, c.objection, c.next_best_action, c.channel, c.customer_name,
  p.id AS recommended_product_id, p.name AS recommended_product_name,
  u.name AS assigned_user_name,
  CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END AS conversation_count,
  GREATEST(
    l.updated_at,
    c.updated_at,
    (SELECT MAX(f.created_at) FROM funnel_events f
      WHERE f.business_id = l.business_id
        AND (f.lead_id = l.id OR (f.conversation_id = l.conversation_id AND f.conversation_id IS NOT NULL)))
  ) AS last_interaction
`;

const CRM_LEAD_JOINS = `
  FROM leads l
  LEFT JOIN touchpoints tp ON tp.id = l.touchpoint_id
  LEFT JOIN agents a ON a.id = l.agent_id
  LEFT JOIN conversations c ON c.id = l.conversation_id
  LEFT JOIN products p ON p.id = c.recommended_product_id
  LEFT JOIN users u ON u.id = l.assigned_user_id
`;

/**
 * Builds the tenant-scoped WHERE clause for CRM lead reads. Filter values are
 * validated by the caller (the route layer) before reaching this function;
 * unknown or absent filters contribute nothing. `search` wildcards are escaped
 * so user input can only match literally.
 */
function crmLeadWhereClause(businessId, { crmStatus, assignedUserId, qualificationStatus, source, search } = {}) {
  const conditions = ['l.business_id = $1'];
  const params = [businessId];

  if (crmStatus) {
    params.push(crmStatus);
    conditions.push(`l.crm_status = $${params.length}`);
  }
  if (assignedUserId) {
    params.push(assignedUserId);
    conditions.push(`l.assigned_user_id = $${params.length}`);
  }
  if (qualificationStatus) {
    params.push(qualificationStatus);
    conditions.push(`l.qualification_status = $${params.length}`);
  }
  if (source) {
    params.push(source);
    conditions.push(`l.source = $${params.length}`);
  }
  if (search) {
    const escaped = search.replace(/[\\%_]/g, (m) => `\\${m}`);
    params.push(`%${escaped}%`);
    const idx = params.length;
    conditions.push(`(l.name ILIKE $${idx} OR l.phone ILIKE $${idx} OR l.email ILIKE $${idx})`);
  }

  return { clause: conditions.join(' AND '), params };
}

export async function listCrmLeads(businessId, { crmStatus, assignedUserId, qualificationStatus, source, search, limit = 50, offset = 0 } = {}) {
  const { clause, params } = crmLeadWhereClause(businessId, { crmStatus, assignedUserId, qualificationStatus, source, search });
  params.push(limit, offset);
  const res = await pool.query(`
    SELECT ${CRM_LEAD_COLUMNS} ${CRM_LEAD_JOINS}
    WHERE ${clause}
    ORDER BY l.updated_at DESC, l.id ASC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);
  return res.rows;
}

export async function countCrmLeads(businessId, { crmStatus, assignedUserId, qualificationStatus, source, search } = {}) {
  const { clause, params } = crmLeadWhereClause(businessId, { crmStatus, assignedUserId, qualificationStatus, source, search });
  const res = await pool.query(
    `SELECT COUNT(*)::int AS n FROM leads l WHERE ${clause}`,
    params
  );
  return res.rows[0].n;
}

export async function getCrmLead(businessId, id) {
  const res = await pool.query(`
    SELECT ${CRM_LEAD_COLUMNS} ${CRM_LEAD_JOINS}
    WHERE l.business_id = $1 AND l.id = $2
  `, [businessId, id]);
  return res.rows[0] || null;
}

/**
 * CRM activity timeline for one lead: events anchored directly by
 * `funnel_events.lead_id` combined with events attached through the lead's
 * 1:1 conversation. The OR is a set union, so an event carrying BOTH lead_id
 * and conversation_id is returned exactly once. Chronological (oldest first).
 * Read-only: never mutates funnel_events.
 */
export async function listLeadActivity(businessId, leadId, conversationId = null) {
  const params = [businessId, leadId];
  let convoClause = '';
  if (conversationId) {
    params.push(conversationId);
    convoClause = ` OR (fe.conversation_id = $${params.length} AND fe.conversation_id IS NOT NULL)`;
  }
  const res = await pool.query(`
    SELECT fe.id, fe.business_id, fe.conversation_id, fe.order_id, fe.lead_id,
           fe.event_type, fe.meta, fe.created_at
    FROM funnel_events fe
    WHERE fe.business_id = $1 AND (fe.lead_id = $2${convoClause})
    ORDER BY fe.created_at ASC, fe.id ASC
  `, params);
  return res.rows;
}

/**
 * LEAD NOTIFICATION STORAGE
 */

export async function createLeadNotification({ businessId, leadId }) {
  const check = await pool.query('SELECT 1 FROM lead_notifications WHERE lead_id = $1', [leadId]);
  if (check.rowCount > 0) return null;

  const id = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO lead_notifications (id, business_id, lead_id) VALUES ($1, $2, $3)',
      [id, businessId, leadId]
    );
    await client.query(
      'UPDATE leads SET notified = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [leadId]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return getLeadNotificationById(id);
}

export async function getLeadNotificationById(id) {
  const res = await pool.query(`
    SELECT n.id, n.business_id, n.lead_id, n.read_at, n.created_at,
      l.name AS lead_name, l.qualification_score, l.qualification_status,
      l.phone, l.email
    FROM lead_notifications n
    JOIN leads l ON l.id = n.lead_id
    WHERE n.id = $1
  `, [id]);
  return res.rows[0] || null;
}

export async function listLeadNotifications(businessId) {
  const res = await pool.query(`
    SELECT n.id, n.lead_id, n.read_at, n.created_at,
      l.name AS lead_name, l.qualification_score, l.qualification_status,
      l.phone, l.email
    FROM lead_notifications n
    JOIN leads l ON l.id = n.lead_id
    WHERE n.business_id = $1 ORDER BY n.created_at DESC
  `, [businessId]);
  return res.rows;
}

export async function countUnreadLeadNotifications(businessId) {
  const res = await pool.query('SELECT COUNT(*) AS n FROM lead_notifications WHERE business_id = $1 AND read_at IS NULL', [businessId]);
  return parseInt(res.rows[0].n, 10);
}

export async function markLeadNotificationsRead(businessId) {
  const res = await pool.query(
    'UPDATE lead_notifications SET read_at = CURRENT_TIMESTAMP WHERE business_id = $1 AND read_at IS NULL',
    [businessId]
  );
  return res.rowCount;
}

/**
 * FUNNEL EVENT STORAGE (Batch 3)
 *
 * Append-only, business-scoped record of observable sales-funnel moments (a
 * contact field captured, a qualification change, a recommendation, an
 * objection, a buying signal, an offered handoff, a started handoff, a
 * quote/booking/demo request). An event is only ever written when the
 * application actually observed the transition — never fabricated from the
 * customer's wishes.
 */
export async function createFunnelEvent({ businessId, conversationId = null, leadId = null, eventType, meta = null }) {
  // The optional lead anchor is tenant-checked when supplied: a lead can only
  // be attached to a funnel event for its own business. When leadId is omitted
  // the behaviour is exactly as before, so existing emitters are unaffected.
  if (leadId !== null && leadId !== undefined) {
    const lead = await pool.query(
      'SELECT 1 FROM leads WHERE id = $1 AND business_id = $2',
      [leadId, businessId]
    );
    if (lead.rowCount === 0) {
      throw new Error('The lead does not belong to this business');
    }
  }
  const id = crypto.randomUUID();
  await pool.query(`
    INSERT INTO funnel_events (id, business_id, conversation_id, lead_id, event_type, meta)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [
    id,
    businessId,
    conversationId,
    leadId === undefined ? null : leadId,
    eventType,
    meta && typeof meta === 'object' ? JSON.stringify(meta) : '{}',
  ]);
  return id;
}

export async function countFunnelEventsByType(businessId, { start = null, end = null } = {}) {
  const { clause, params } = analyticsRangeClause(start, end, 2);
  const res = await pool.query(
    `SELECT event_type AS type, COUNT(*) AS n
     FROM funnel_events
     WHERE business_id = $1${clause}
     GROUP BY event_type
     ORDER BY n DESC`,
    [businessId, ...params]
  );
  return res.rows.map((row) => ({ type: row.type, count: parseInt(row.n, 10) }));
}

/**
 * Conversation-scoped deduplication probe: has this exact observable event
 * (optionally distinguished by a meta key) already been recorded for this
 * conversation? Used only to avoid repeating an identical offer/start event
 * when the assistant restates the same channel — not a general event store.
 */
export async function hasFunnelEvent({ businessId, conversationId = null, eventType, metaKey = null }) {
  const params = [businessId, eventType];
  let sql = 'SELECT 1 FROM funnel_events WHERE business_id = $1 AND event_type = $2';
  if (conversationId) {
    params.push(conversationId);
    sql += ` AND conversation_id = $${params.length}`;
  } else {
    sql += ' AND conversation_id IS NULL';
  }
  if (metaKey !== null && metaKey !== undefined) {
    params.push(metaKey);
    sql += ` AND meta->>'key' = $${params.length}`;
  }
  sql += ' LIMIT 1';
  const res = await pool.query(sql, params);
  return res.rows.length > 0;
}

/**
 * ANALYTICS STORAGE
 */

const ANALYTICS_COUNTS = {
  scans: 'touchpoint_scans',
  conversations: 'conversations',
  leads: 'leads',
};

function analyticsRangeClause(start, end, paramOffset = 1) {
  const clause = [];
  const params = [];
  if (start !== null && start !== undefined) {
    clause.push(`created_at >= $${paramOffset + params.length}`);
    params.push(start);
  }
  if (end !== null && end !== undefined) {
    clause.push(`created_at < $${paramOffset + params.length}`);
    params.push(end);
  }
  return { clause: clause.length ? ` AND ${clause.join(' AND ')}` : '', params };
}

export async function countAnalyticsRows(businessId, source, { start = null, end = null, qualifiedOnly = false } = {}) {
  const { clause, params } = analyticsRangeClause(start, end, 2);
  const qualified = qualifiedOnly ? " AND qualification_status = 'qualified'" : '';
  const res = await pool.query(
    `SELECT COUNT(*) AS n FROM ${ANALYTICS_COUNTS[source]} WHERE business_id = $1${clause}${qualified}`,
    [businessId, ...params]
  );
  return parseInt(res.rows[0].n, 10);
}

export async function analyticsBucketCounts(businessId, source, { start, end, bucketExpr, qualifiedOnly = false }) {
  const { clause, params } = analyticsRangeClause(start, end, 2);
  const qualified = qualifiedOnly ? " AND qualification_status = 'qualified'" : '';
  
  // bucketExpr needs to be translated for PG if it was SQLite specific.
  // The caller in server.js passes:
  // "substr(created_at, 1, 13) || ':00'" for hours
  // "substr(created_at, 1, 10)" for days
  // We should translate these to PG to_char or date_trunc equivalents if needed,
  // but for now we'll see if we can keep them or if we need to replace them.
  // Actually, the caller passed them as strings. Let's make it PG compatible.
  
  let pgBucketExpr = bucketExpr;
  if (bucketExpr.includes('substr(created_at, 1, 13)')) {
    pgBucketExpr = "to_char(created_at, 'YYYY-MM-DD HH24') || ':00'";
  } else if (bucketExpr.includes('substr(created_at, 1, 10)')) {
    pgBucketExpr = "to_char(created_at, 'YYYY-MM-DD')";
  }

  const res = await pool.query(
    `SELECT ${pgBucketExpr} AS bucket, COUNT(*) AS n
     FROM ${ANALYTICS_COUNTS[source]}
     WHERE business_id = $1${clause}${qualified}
     GROUP BY bucket`,
    [businessId, ...params]
  );
  return res.rows.map((row) => ({ bucket: row.bucket, count: parseInt(row.n, 10) }));
}

export async function analyticsGroupedCounts(businessId, source, { start = null, end = null, groupBy, qualifiedOnly = false } = {}) {
  const { clause, params } = analyticsRangeClause(start, end, 2);
  const qualified = qualifiedOnly ? " AND qualification_status = 'qualified'" : '';
  const res = await pool.query(
    `SELECT ${groupBy} AS id, COUNT(*) AS n
     FROM ${ANALYTICS_COUNTS[source]}
     WHERE business_id = $1${clause}${qualified}
     GROUP BY ${groupBy}`,
    [businessId, ...params]
  );
  return res.rows.map((row) => ({ id: row.id, count: parseInt(row.n, 10) }));
}

/**
 * PASSWORD RESET STORAGE
 */

export async function createResetToken({ userId, tokenHash, expiresAt }) {
  const id = crypto.randomUUID();
  await pool.query(
    'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
    [id, userId, tokenHash, expiresAt]
  );
  return id;
}

export async function findResetToken(tokenHash) {
  const res = await pool.query(
    'SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP',
    [tokenHash]
  );
  return res.rows[0] || null;
}

export async function consumeResetToken(id) {
  await pool.query(
    'UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1',
    [id]
  );
}

export async function invalidateUserTokens(userId) {
  await pool.query(
    'UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND used_at IS NULL',
    [userId]
  );
}

export async function updateUserPassword(userId, passwordHash) {
  await pool.query(
    'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [passwordHash, userId]
  );
}

/**
 * COMMERCIAL TRANSACTIONS (Phase 13A)
 *
 * Orders are deterministic: totals are always computed by the server from the
 * authoritative product price; a client body can never influence money
 * figures. Status transitions are compare-and-set so the state machine is the
 * single source of truth even under concurrency.
 */

const ORDER_COLUMNS = `
  o.id, o.business_id, o.conversation_id, o.lead_id, o.channel, o.customer_name,
  o.status, o.currency, o.subtotal, o.total, o.payment_status,
  o.fulfillment_status, o.metadata, o.created_at, o.updated_at
`;

const parseMoney = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export async function createOrderRecord({ businessId, conversationId = null, leadId = null, channel = 'web', customerName = null, currency = 'NGN', lines, metadata = null }) {
  const orderId = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO orders (id, business_id, conversation_id, lead_id, channel, customer_name, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [orderId, businessId, conversationId || null, leadId || null, channel || 'web', customerName || null, currency]
    );
    const items = [];
    let subtotal = 0;
    for (const line of lines) {
      const itemId = crypto.randomUUID();
      const lineTotal = Math.round(line.quantity * line.unitPrice * 100) / 100;
      subtotal = Math.round((subtotal + lineTotal) * 100) / 100;
      await client.query(
        `INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, total, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [itemId, orderId, line.productId, line.productName, line.quantity, line.unitPrice, lineTotal, line.metadata || '{}']
      );
      items.push({ id: itemId, product_id: line.productId, product_name: line.productName, quantity: line.quantity, unit_price: line.unitPrice, total: lineTotal });
    }
    await client.query(
      'UPDATE orders SET subtotal = $1, total = $2 WHERE id = $3',
      [subtotal, subtotal, orderId]
    );
    await client.query('COMMIT');
    return { orderId, items, subtotal, total: subtotal, currency };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function getOrderById(businessId, id) {
  const res = await pool.query(
    `SELECT ${ORDER_COLUMNS} FROM orders o WHERE o.id = $1 AND o.business_id = $2`,
    [id, businessId]
  );
  const order = res.rows[0] || null;
  if (!order) return null;
  const items = await pool.query(
    `SELECT id, order_id, product_id, product_name, quantity, unit_price, total, metadata, created_at
     FROM order_items WHERE order_id = $1 ORDER BY created_at ASC`,
    [order.id]
  );
  return {
    ...order,
    subtotal: parseMoney(order.subtotal),
    total: parseMoney(order.total),
    items: items.rows.map((i) => ({ ...i, unit_price: parseMoney(i.unit_price), total: parseMoney(i.total) })),
  };
}

export async function listOrders(businessId) {
  const res = await pool.query(
    `SELECT ${ORDER_COLUMNS},
       (SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count
     FROM orders o
     WHERE o.business_id = $1
     ORDER BY o.created_at DESC`,
    [businessId]
  );
  return res.rows.map((o) => ({ ...o, subtotal: parseMoney(o.subtotal), total: parseMoney(o.total) }));
}

export async function listOrdersByConversation(businessId, conversationId) {
  const res = await pool.query(`
    SELECT ${ORDER_COLUMNS} FROM orders o
    WHERE o.business_id = $1 AND o.conversation_id = $2
    ORDER BY o.created_at DESC
  `, [businessId, conversationId]);
  return res.rows.map((o) => ({ ...o, subtotal: parseMoney(o.subtotal), total: parseMoney(o.total) }));
}

/**
 * Compare-and-set order status transition. The allowed-transition policy lives
 * in the server (ORDER_TRANSITIONS); this storage call moves a row only when
 * its current status still matches the expected one, so two concurrent
 * transition requests cannot both succeed.
 */
export async function setOrderStatus(businessId, id, nextStatus, expectedStatus) {
  const res = await pool.query(
    `UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND business_id = $3 AND status = $4
     RETURNING id`,
    [nextStatus, id, businessId, expectedStatus]
  );
  return res.rows.length > 0;
}

export async function setOrderPaymentStatus(businessId, id, paymentStatus) {
  const res = await pool.query(
    `UPDATE orders SET payment_status = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND business_id = $3`,
    [paymentStatus, id, businessId]
  );
  return res.rowCount > 0;
}

export async function setOrderMetadata(businessId, id, metadata) {
  await pool.query(
    `UPDATE orders SET metadata = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND business_id = $3`,
    [JSON.stringify(metadata || {}), id, businessId]
  );
}

/**
 * Adds a line to an existing order and recomputes its totals. Only used while
 * the order is still in a mutable status (the server enforces that); the unit
 * price always comes from the authoritative product, never from the request.
 */
export async function addOrderItemRecord(businessId, orderId, line) {
  const order = await getOrderById(businessId, orderId);
  if (!order) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exists = await client.query(
      'SELECT 1 FROM order_items WHERE order_id = $1 AND product_id = $2',
      [orderId, line.productId]
    );
    if (exists.rowCount > 0) {
      await client.query('ROLLBACK');
      return { duplicate: true };
    }
    const itemId = crypto.randomUUID();
    const lineTotal = Math.round(line.quantity * line.unitPrice * 100) / 100;
    await client.query(
      `INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, total, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [itemId, orderId, line.productId, line.productName, line.quantity, line.unitPrice, lineTotal, line.metadata || '{}']
    );
    const subtotal = Math.round((parseMoney(order.subtotal) + lineTotal) * 100) / 100;
    await client.query(
      'UPDATE orders SET subtotal = $1, total = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND business_id = $3',
      [subtotal, orderId, businessId]
    );
    await client.query('COMMIT');
    return { itemId, lineTotal };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * COMMERCIAL ACTIONS (Phase 13A)
 *
 * The AI may only propose; execution/status is server-controlled. A request
 * body can never set status — it is always created 'proposed' here.
 */
export async function createCommercialAction({ businessId, conversationId = null, actionType, leadId = null, productId = null, orderId = null, customer = null, metadata = null }) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO commercial_actions (id, business_id, conversation_id, action_type, status, lead_id, product_id, order_id, customer, metadata)
     VALUES ($1, $2, $3, $4, 'proposed', $5, $6, $7, $8, $9)`,
    [id, businessId, conversationId || null, actionType, leadId || null, productId || null, orderId || null,
      customer && typeof customer === 'object' ? JSON.stringify(customer) : '{}',
      metadata && typeof metadata === 'object' ? JSON.stringify(metadata) : '{}']
  );
  return getCommercialAction(businessId, id);
}

export async function getCommercialAction(businessId, id) {
  const res = await pool.query(
    `SELECT id, business_id, conversation_id, action_type, status, lead_id, product_id, order_id,
            customer, metadata, created_at, updated_at
     FROM commercial_actions WHERE id = $1 AND business_id = $2`,
    [id, businessId]
  );
  return res.rows[0] || null;
}

export async function listCommercialActions(businessId, { status = null } = {}) {
  let sql = 'SELECT id, business_id, conversation_id, action_type, status, lead_id, product_id, order_id, customer, metadata, created_at, updated_at FROM commercial_actions WHERE business_id = $1';
  const params = [businessId];
  if (status) {
    params.push(status);
    sql += ` AND status = $${params.length}`;
  }
  sql += ' ORDER BY created_at DESC';
  const res = await pool.query(sql, params);
  return res.rows;
}

/**
 * Compare-and-set commercial-action status transition. Only the server invokes
 * this after it has actually performed (or rejected) the underlying work.
 */
export async function setCommercialActionStatus(businessId, id, nextStatus, expectedStatus) {
  const res = await pool.query(
    `UPDATE commercial_actions SET status = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND business_id = $3 AND status = $4
     RETURNING id`,
    [nextStatus, id, businessId, expectedStatus]
  );
  return res.rows.length > 0;
}

export async function linkCommercialActionOrder(businessId, id, orderId) {
  const res = await pool.query(
    `UPDATE commercial_actions SET order_id = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND business_id = $3`,
    [orderId, id, businessId]
  );
  return res.rowCount > 0;
}

/**
 * CHANNEL IDENTITY + CONFIGURATION (Phase 13A)
 */
export async function getChannelIdentity(businessId, channel, externalId) {
  const res = await pool.query(
    `SELECT id, business_id, channel, external_id, conversation_id, created_at, updated_at
     FROM channel_identities WHERE business_id = $1 AND channel = $2 AND external_id = $3`,
    [businessId, channel, externalId]
  );
  return res.rows[0] || null;
}

export async function createChannelIdentity({ businessId, channel, externalId, conversationId }) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO channel_identities (id, business_id, channel, external_id, conversation_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (business_id, channel, external_id) DO UPDATE SET conversation_id = EXCLUDED.conversation_id, updated_at = CURRENT_TIMESTAMP`,
    [id, businessId, channel, externalId, conversationId]
  );
  return getChannelIdentity(businessId, channel, externalId);
}

export async function getChannelConfigForBusiness(businessId, channel) {
  const res = await pool.query(
    `SELECT id, business_id, channel, enabled, status, display_name,
            phone_number_id, provider_business_account_id, created_at, updated_at
     FROM channel_config WHERE business_id = $1 AND channel = $2`,
    [businessId, channel]
  );
  return res.rows[0] || null;
}

export async function getChannelConfigByPhoneNumberId(phoneNumberId) {
  if (!phoneNumberId) return null;
  const res = await pool.query(
    `SELECT id, business_id, channel, enabled, status, display_name,
            phone_number_id, provider_business_account_id, created_at, updated_at
     FROM channel_config WHERE phone_number_id = $1`,
    [phoneNumberId]
  );
  return res.rows[0] || null;
}

export async function upsertChannelConfig(businessId, channel, {
  enabled = null, status = null, displayName = null, phoneNumberId = null, providerBusinessAccountId = null,
} = {}) {
  const existing = await getChannelConfigForBusiness(businessId, channel);
  const values = {
    enabled: enabled === null || enabled === undefined ? (existing ? existing.enabled : false) : !!enabled,
    status: status ?? (existing ? existing.status : 'not_configured'),
    displayName: displayName ?? (existing ? existing.display_name : 'WhatsApp'),
    phoneNumberId: phoneNumberId === null || phoneNumberId === undefined ? (existing ? existing.phone_number_id : null) : phoneNumberId,
    providerBusinessAccountId:
      providerBusinessAccountId === null || providerBusinessAccountId === undefined
        ? (existing ? existing.provider_business_account_id : null)
        : providerBusinessAccountId,
  };
  await pool.query(
    `INSERT INTO channel_config (id, business_id, channel, enabled, status, display_name, phone_number_id, provider_business_account_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (business_id, channel) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       status = EXCLUDED.status,
       display_name = EXCLUDED.display_name,
       phone_number_id = EXCLUDED.phone_number_id,
       provider_business_account_id = EXCLUDED.provider_business_account_id,
       updated_at = CURRENT_TIMESTAMP`,
    [
      crypto.randomUUID(), businessId, channel, values.enabled, values.status, values.displayName,
      values.phoneNumberId, values.providerBusinessAccountId,
    ]
  );
  return getChannelConfigForBusiness(businessId, channel);
}

export async function listChannelConfigs(businessId) {
  const res = await pool.query(
    `SELECT id, business_id, channel, enabled, status, display_name,
            phone_number_id, provider_business_account_id, created_at, updated_at
     FROM channel_config WHERE business_id = $1 ORDER BY channel`,
    [businessId]
  );
  return res.rows;
}

const WHATSAPP_MESSAGE_COLUMNS = `
  id, business_id, conversation_id, direction, wa_message_id, status,
  message_type, customer_phone, body, media, provider_error, payload,
  created_at, updated_at
`;

const mapWhatsAppMessage = (row) =>
  row
    ? {
        ...row,
        media: row.media || {},
        payload: row.payload || {},
      }
    : null;

export async function createWhatsAppMessage({
  businessId, conversationId, direction, waMessageId, status = 'queued', messageType = 'text',
  customerPhone, body = null, media = {}, providerError = null, payload = {},
}) {
  const id = crypto.randomUUID();
  const res = await pool.query(
    `INSERT INTO whatsapp_messages
       (id, business_id, conversation_id, direction, wa_message_id, status, message_type,
        customer_phone, body, media, provider_error, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING
     RETURNING ${WHATSAPP_MESSAGE_COLUMNS}`,
    [
      id, businessId, conversationId, direction, waMessageId || null, status, messageType,
      customerPhone, body, JSON.stringify(media || {}), providerError, JSON.stringify(payload || {}),
    ]
  );
  return mapWhatsAppMessage(res.rows[0] || null);
}

export async function getWhatsAppMessageById(id) {
  const res = await pool.query(
    `SELECT ${WHATSAPP_MESSAGE_COLUMNS} FROM whatsapp_messages WHERE id = $1`,
    [id]
  );
  return mapWhatsAppMessage(res.rows[0] || null);
}

export async function getWhatsAppMessageByWaId(waMessageId) {
  if (!waMessageId) return null;
  const res = await pool.query(
    `SELECT ${WHATSAPP_MESSAGE_COLUMNS} FROM whatsapp_messages WHERE wa_message_id = $1`,
    [waMessageId]
  );
  return mapWhatsAppMessage(res.rows[0] || null);
}

export async function updateWhatsAppMessageByWaId(waMessageId, { status = null, providerError = null, payload = null }) {
  if (!waMessageId) return null;
  const parts = [];
  const params = [waMessageId];
  if (status) {
    params.push(status);
    parts.push(`status = $${params.length}`);
  }
  if (providerError !== null && providerError !== undefined) {
    params.push(providerError);
    parts.push(`provider_error = $${params.length}`);
  }
  if (payload !== null && payload !== undefined) {
    params.push(JSON.stringify(payload));
    parts.push(`payload = $${params.length}`);
  }
  if (parts.length === 0) return getWhatsAppMessageByWaId(waMessageId);
  parts.push('updated_at = CURRENT_TIMESTAMP');
  const res = await pool.query(
    `UPDATE whatsapp_messages SET ${parts.join(', ')} WHERE wa_message_id = $1 RETURNING ${WHATSAPP_MESSAGE_COLUMNS}`,
    params
  );
  const row = res.rows[0] || null;
  return mapWhatsAppMessage(row);
}

export async function listWhatsAppMessages(conversationId, { limit = 100, direction = null } = {}) {
  const params = [conversationId, limit];
  let filter = 'conversation_id = $1';
  if (direction) {
    params.splice(1, 0, direction);
    filter = 'conversation_id = $1 AND direction = $2';
  }
  const res = await pool.query(
    `SELECT ${WHATSAPP_MESSAGE_COLUMNS} FROM whatsapp_messages WHERE ${filter}
     ORDER BY created_at, id LIMIT $${params.length}`,
    params
  );
  return res.rows.map(mapWhatsAppMessage);
}

export async function findDefaultAgent(businessId) {
  const res = await pool.query(
    `SELECT id, name, status FROM agents WHERE business_id = $1 AND status = 'Active' ORDER BY created_at ASC LIMIT 1`,
    [businessId]
  );
  return res.rows[0] || null;
}

/**
 * PAYMENT INTENTS (Phase 13B)
 *
 * The provider-neutral intent ledger. Every order can have at most one live
 * `pending` intent at a time (partial unique index on order_id), and a provider
 * reference maps to exactly one intent, so a provider transaction can settle
 * one and only one order. All money at this boundary is integer minor units;
 * the decimal order total is converted once upstream.
 */
const PAYMENT_INTENT_COLUMNS = `
  pi.id, pi.business_id, pi.order_id, pi.provider, pi.status,
  pi.provider_reference, pi.expected_amount_minor, pi.currency,
  pi.idempotency_key, pi.checkout_metadata, pi.metadata, pi.failure_reason,
  pi.paid_amount_minor, pi.provider_event_id, pi.verified_at,
  pi.created_at, pi.updated_at
`;

const mapPaymentIntent = (row) =>
  row
    ? {
        ...row,
        expected_amount_minor: row.expected_amount_minor != null ? Number(row.expected_amount_minor) : null,
        paid_amount_minor: row.paid_amount_minor != null ? Number(row.paid_amount_minor) : null,
        checkout_metadata: row.checkout_metadata || {},
        metadata: row.metadata || {},
      }
    : null;

export async function createPaymentIntent({
  businessId,
  orderId,
  provider,
  providerReference,
  expectedAmountMinor,
  currency,
  idempotencyKey = null,
  metadata = null,
}) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO payment_intents
       (id, business_id, order_id, provider, status, provider_reference,
        expected_amount_minor, currency, idempotency_key, checkout_metadata, metadata)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, '{}', $9)`,
    [id, businessId, orderId, provider, providerReference, expectedAmountMinor, currency,
      idempotencyKey || null,
      metadata && typeof metadata === 'object' ? JSON.stringify(metadata) : '{}']
  );
  return getPaymentIntentById(businessId, id);
}

export async function getPaymentIntentById(businessId, id) {
  const res = await pool.query(
    `SELECT ${PAYMENT_INTENT_COLUMNS} FROM payment_intents pi WHERE pi.id = $1 AND pi.business_id = $2`,
    [id, businessId]
  );
  return mapPaymentIntent(res.rows[0] || null);
}

/** Provider-scoped lookup for webhook settlement. Intentionally NOT business-scoped. */
export async function getPaymentIntentByReference(provider, providerReference) {
  const res = await pool.query(
    `SELECT ${PAYMENT_INTENT_COLUMNS} FROM payment_intents pi
     WHERE pi.provider = $1 AND pi.provider_reference = $2`,
    [provider, providerReference]
  );
  return mapPaymentIntent(res.rows[0] || null);
}

export async function listPaymentIntentsByOrder(businessId, orderId) {
  const res = await pool.query(
    `SELECT ${PAYMENT_INTENT_COLUMNS} FROM payment_intents pi
     WHERE pi.business_id = $1 AND pi.order_id = $2
     ORDER BY pi.created_at DESC`,
    [businessId, orderId]
  );
  return res.rows.map(mapPaymentIntent);
}

/** Compare-and-set intent status transition (only server code invokes this). */
export async function setPaymentIntentStatus(businessId, id, nextStatus, expectedStatus, { failureReason = null } = {}) {
  const res = await pool.query(
    `UPDATE payment_intents SET status = $1,
       failure_reason = $2,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $3 AND business_id = $4 AND status = $5
     RETURNING id`,
    [nextStatus, failureReason, id, businessId, expectedStatus]
  );
  return res.rows.length > 0;
}

/** Persist the provider checkout URL returned at initialization time. */
export async function setPaymentIntentCheckout(businessId, id, checkout) {
  await pool.query(
    `UPDATE payment_intents SET checkout_metadata = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND business_id = $3`,
    [JSON.stringify(checkout || {}), id, businessId]
  );
}

/**
 * Voids every live pending intent for an order (used when the order is
 * cancelled). A cancelled order can never settle anyway (settleOrderPayment
 * refuses), but voiding avoids leaving a dangling checkout the customer could
 * still try to complete.
 */
export async function voidPendingPaymentIntents(businessId, orderId, reason = 'order_cancelled') {
  await pool.query(
    `UPDATE payment_intents SET status = 'void', failure_reason = $1, updated_at = CURRENT_TIMESTAMP
     WHERE order_id = $2 AND business_id = $3 AND status = 'pending'`,
    [reason, orderId, businessId]
  );
}

/**
 * The single atomic settlement transition. Locks the order and the intent, and
 * moves both only when: the order is `pending_payment` and not yet paid, and
 * the intent is the order's own row still `pending`. Under row locks this
 * serializes concurrent webhooks AND concurrent init-failure rollbacks, so a
 * reference can settle at most once and only its exact order.
 */
export async function settleOrderPayment({ businessId, orderId, intentId, providerEventId = null, paidAmountMinor }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderRes = await client.query(
      `SELECT status, conversation_id FROM orders WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [orderId, businessId]
    );
    const order = orderRes.rows[0];
    if (!order) throw new Error('Order not found for settlement');
    if (order.status === 'paid') {
      await client.query('ROLLBACK');
      return { outcome: 'already_paid', orderId };
    }
    if (order.status !== 'pending_payment') {
      await client.query('ROLLBACK');
      return { outcome: 'not_payable', orderStatus: order.status, orderId };
    }

    const intentRes = await client.query(
      `SELECT status FROM payment_intents
       WHERE id = $1 AND order_id = $2 AND business_id = $3 FOR UPDATE`,
      [intentId, orderId, businessId]
    );
    const intent = intentRes.rows[0];
    if (!intent) throw new Error('Intent not found for settlement');
    if (intent.status !== 'pending') {
      await client.query('ROLLBACK');
      return { outcome: 'intent_already_processed', intentStatus: intent.status };
    }

    await client.query(
      `UPDATE payment_intents
       SET status = 'succeeded', paid_amount_minor = $1, provider_event_id = $2, failure_reason = NULL,
           verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [paidAmountMinor, providerEventId, intentId]
    );
    await client.query(
      `UPDATE orders SET status = 'paid', payment_status = 'paid', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND business_id = $2`,
      [orderId, businessId]
    );
    await client.query('COMMIT');
    return { outcome: 'settled', orderId, intentId };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Records a provider-reported failure/expiry against a live pending intent and
 * mirrors the last observed attempt onto order.payment_status. The ORDER itself
 * stays `pending_payment` (retryable); only the intent goes terminal.
 */
export async function recordIntentFailure({ businessId, orderId, intentId, intentStatus, failureReason, orderPaymentStatus }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderRes = await client.query(
      `SELECT status FROM orders WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [orderId, businessId]
    );
    const order = orderRes.rows[0];
    if (!order) {
      await client.query('ROLLBACK');
      return { outcome: 'not_found' };
    }
    if (order.status === 'paid') {
      await client.query('ROLLBACK');
      return { outcome: 'already_paid' };
    }
    const intentRes = await client.query(
      `SELECT status FROM payment_intents
       WHERE id = $1 AND order_id = $2 AND business_id = $3 FOR UPDATE`,
      [intentId, orderId, businessId]
    );
    const intent = intentRes.rows[0];
    if (!intent) {
      await client.query('ROLLBACK');
      return { outcome: 'not_found' };
    }
    if (intent.status !== 'pending') {
      await client.query('ROLLBACK');
      return { outcome: 'already_processed' };
    }
    await client.query(
      `UPDATE payment_intents SET status = $1, failure_reason = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [intentStatus, failureReason, intentId]
    );
    await client.query(
      `UPDATE orders SET payment_status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND business_id = $3`,
      [orderPaymentStatus, orderId, businessId]
    );
    await client.query('COMMIT');
    return {
      outcome: 'recorded',
      meta: { intentId, intentStatus, failureReason, orderPaymentStatus },
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * BOOKING STORAGE (Phase 13C)
 *
 * Reservations and transitions are the SERVER's job. Every mutating booking
 * operation is transactional and fielding an advisory lock on the exact slot
 * (business:product:start), so concurrent reservation/reschedule of the same
 * slot serializes and the capacity check stays exact — the occupied interval
 * is [requested_start_at, end_at) including buffer padding (correction E).
 */

export class BookingConflictError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BookingConflictError';
    this.code = code;
  }
}

const BOOKING_COLUMNS = `
  b.id, b.business_id, b.product_id, b.conversation_id, b.lead_id, b.order_id,
  b.customer, b.name, b.phone, b.email, b.timezone, b.duration_minutes,
  b.requested_start_at, b.end_at, b.status, b.idempotency_key, b.config_version,
  b.hold_until, b.metadata, b.created_at, b.updated_at,
  p.name AS product_name
`;

const BOOKING_CONFIG_COLUMNS = `
  bc.id, bc.business_id, bc.product_id, bc.timezone, bc.slot_duration_minutes,
  bc.buffer_minutes, bc.capacity, bc.operating_hours, bc.blackout_dates,
  bc.min_advance_hours, bc.max_advance_days, bc.auto_confirm, bc.hold_minutes,
  bc.allow_reschedule, bc.requires_payment, bc.config_version,
  bc.created_at, bc.updated_at, p.name AS product_name, p.bookable AS product_bookable
`;

function bookingRow(row) {
  return {
    ...row,
    duration_minutes: Number(row.duration_minutes),
    config_version: Number(row.config_version),
  };
}

function bookingConfigRow(row) {
  return {
    ...row,
    slot_duration_minutes: Number(row.slot_duration_minutes),
    buffer_minutes: Number(row.buffer_minutes),
    capacity: Number(row.capacity),
    min_advance_hours: Number(row.min_advance_hours),
    max_advance_days: Number(row.max_advance_days),
    hold_minutes: Number(row.hold_minutes),
    config_version: Number(row.config_version),
  };
}

/**
 * Fetches the booking policy for a bookable product, tenant-scoped.
 */
export async function getBookingConfig(businessId, productId) {
  const res = await pool.query(
    `SELECT ${BOOKING_CONFIG_COLUMNS} FROM booking_configs bc
     JOIN products p ON p.id = bc.product_id
     WHERE bc.business_id = $1 AND bc.product_id = $2`,
    [businessId, productId]
  );
  return res.rows[0] ? bookingConfigRow(res.rows[0]) : null;
}

export async function listBookingConfigs(businessId) {
  const res = await pool.query(
    `SELECT ${BOOKING_CONFIG_COLUMNS} FROM booking_configs bc
     JOIN products p ON p.id = bc.product_id
     WHERE bc.business_id = $1 ORDER BY bc.created_at ASC`,
    [businessId]
  );
  return res.rows.map(bookingConfigRow);
}

/**
 * Creates or replaces the booking policy for a product. Every successful
 * update bumps config_version, which invalidates previously issued slot tokens
 * (the server maps that to STALE_SLOT) — availability-affecting or not, an
 * edit always re-pins the schedule the tokens describe.
 */
export async function putBookingConfig(businessId, productId, value) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO booking_configs (
      id, business_id, product_id, timezone, slot_duration_minutes, buffer_minutes,
      capacity, operating_hours, blackout_dates, min_advance_hours, max_advance_days,
      auto_confirm, hold_minutes, allow_reschedule, requires_payment, config_version
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 1)
    ON CONFLICT (product_id) DO UPDATE SET
      timezone = EXCLUDED.timezone,
      slot_duration_minutes = EXCLUDED.slot_duration_minutes,
      buffer_minutes = EXCLUDED.buffer_minutes,
      capacity = EXCLUDED.capacity,
      operating_hours = EXCLUDED.operating_hours,
      blackout_dates = EXCLUDED.blackout_dates,
      min_advance_hours = EXCLUDED.min_advance_hours,
      max_advance_days = EXCLUDED.max_advance_days,
      auto_confirm = EXCLUDED.auto_confirm,
      hold_minutes = EXCLUDED.hold_minutes,
      allow_reschedule = EXCLUDED.allow_reschedule,
      requires_payment = EXCLUDED.requires_payment,
      config_version = booking_configs.config_version + 1,
      updated_at = CURRENT_TIMESTAMP`,
    [
      id, businessId, productId, value.timezone, value.slot_duration_minutes,
      value.buffer_minutes, value.capacity,
      JSON.stringify(value.operating_hours), JSON.stringify(value.blackout_dates),
      value.min_advance_hours, value.max_advance_days, value.auto_confirm,
      value.hold_minutes, value.allow_reschedule, value.requires_payment,
    ]
  );
  return getBookingConfig(businessId, productId);
}

export async function deleteBookingConfig(businessId, productId) {
  const res = await pool.query(
    'DELETE FROM booking_configs WHERE business_id = $1 AND product_id = $2',
    [businessId, productId]
  );
  return res.rowCount > 0;
}

/**
 * Counts occupying (reserved/confirmed) bookings overlapping [start, end).
 */
async function countSlotOverlap(client, { businessId, productId, start, end, excludeBookingId = null, lockKey }) {
  if (lockKey) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [lockKey]);
  }
  const params = [businessId, productId, start.toISOString(), end.toISOString()];
  let sql = `
    SELECT COUNT(*) AS n FROM bookings
    WHERE business_id = $1 AND product_id = $2
      AND status IN ('reserved', 'confirmed')
      AND requested_start_at < $4 AND end_at > $3`;
  if (excludeBookingId) {
    params.push(excludeBookingId);
    sql += ` AND id <> $${params.length}`;
  }
  const res = await client.query(sql, params);
  return parseInt(res.rows[0].n, 10);
}

export async function getBooking(businessId, id) {
  const res = await pool.query(
    `SELECT ${BOOKING_COLUMNS} FROM bookings b
     JOIN products p ON p.id = b.product_id
     WHERE b.business_id = $1 AND b.id = $2`,
    [businessId, id]
  );
  return res.rows[0] ? bookingRow(res.rows[0]) : null;
}

export async function listBookings(businessId, { status = null, productId = null, from = null, to = null } = {}) {
  const params = [businessId];
  let sql = `SELECT ${BOOKING_COLUMNS} FROM bookings b JOIN products p ON p.id = b.product_id WHERE b.business_id = $1`;
  if (status) {
    params.push(status);
    sql += ` AND b.status = $${params.length}`;
  }
  if (productId) {
    params.push(productId);
    sql += ` AND b.product_id = $${params.length}`;
  }
  if (from) {
    params.push(from.toISOString());
    sql += ` AND b.requested_start_at >= $${params.length}`;
  }
  if (to) {
    params.push(to.toISOString());
    sql += ` AND b.requested_start_at < $${params.length}`;
  }
  sql += ' ORDER BY b.requested_start_at ASC LIMIT 200';
  const res = await pool.query(sql, params);
  return res.rows.map(bookingRow);
}

/**
 * Transactional reservation. Advisory-locked on the exact slot, then an exact
 * capacity count (occupied interval including buffers) before insert, then an
 * idempotent insert (retried requests with the same business+idempotency_key
 * return the existing booking with `duplicate: true`). Status is decided by the
 * server policy: confirmed when auto_confirm and no required payment, otherwise
 * reserved with a hold_until window.
 *
 * Throws BookingConflictError('SLOT_NOT_AVAILABLE') when the slot is full.
 */
export async function reserveBooking({
  businessId, productId, conversationId = null, leadId = null,
  slot, config, customer = {}, name = null, phone = null, email = null,
  idempotencyKey = null, now = new Date(),
}) {
  const startIso = slot.start.toISOString();
  const lockKey = `${businessId}:${productId}:${startIso}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [lockKey]);

    if (idempotencyKey) {
      const existing = await client.query(
        'SELECT id FROM bookings WHERE business_id = $1 AND idempotency_key = $2',
        [businessId, idempotencyKey]
      );
      if (existing.rows.length > 0) {
        await client.query('COMMIT');
        const booking = await getBooking(businessId, existing.rows[0].id);
        return { booking, duplicate: true };
      }
    }

    const occupied = await countSlotOverlap(client, { businessId, productId, start: slot.start, end: slot.end });
    if (occupied >= config.capacity) {
      await client.query('ROLLBACK');
      throw new BookingConflictError('SLOT_NOT_AVAILABLE', 'This slot is no longer available.');
    }

    const autoConfirmed = config.auto_confirm && !config.requires_payment;
    const id = crypto.randomUUID();
    const holdUntil = autoConfirmed
      ? null
      : new Date(now.getTime() + config.hold_minutes * 60000);
    const insertRes = await client.query(
      `INSERT INTO bookings (
        id, business_id, product_id, conversation_id, lead_id, customer, name,
        phone, email, timezone, duration_minutes, requested_start_at, end_at,
        status, idempotency_key, config_version, hold_until, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, '{}')
      RETURNING id`,
      [
        id, businessId, productId, conversationId, leadId,
        JSON.stringify(customer), name, phone, email, config.timezone,
        slot.durationMinutes, startIso, slot.end.toISOString(),
        autoConfirmed ? 'confirmed' : 'reserved', idempotencyKey,
        config.config_version, holdUntil,
      ]
    );
    await client.query('COMMIT');
    const booking = await getBooking(businessId, insertRes.rows[0].id);
    return { booking, duplicate: false };
  } catch (e) {
    await client.query('ROLLBACK');
    if (e instanceof BookingConflictError) throw e;
    // Unique violation on (business_id, idempotency_key): a concurrent request
    // with the same key won the insert; return its booking instead of failing.
    if (e.code === '23505') {
      const existing = await client.query(
        'SELECT id FROM bookings WHERE business_id = $1 AND idempotency_key = $2',
        [businessId, idempotencyKey]
      );
      if (existing.rows.length > 0) {
        const booking = await getBooking(businessId, existing.rows[0].id);
        return { booking, duplicate: true };
      }
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Compare-and-set status transition. Only the server calls this, only with a
 * legal `from` -> `to` pair, and only when the action actually happened. Any
 * nonzero status change marks updated_at. Returns the refreshed booking or
 * null when the CAS lost (STALE_STATE).
 */
export async function transitionBooking(businessId, id, { to, from, patch = null }) {
  const params = [businessId, id, to, from];
  let sql = `
    UPDATE bookings SET status = $3, updated_at = CURRENT_TIMESTAMP,
      hold_until = CASE WHEN $3 = 'confirmed' THEN NULL ELSE hold_until END`;
  if (patch && typeof patch === 'object') {
    params.push(JSON.stringify(patch));
    sql += `, metadata = COALESCE(metadata, '{}'::jsonb) || $${params.length}::jsonb`;
  }
  sql += ` WHERE business_id = $1 AND id = $2 AND status = ANY($4)`;
  const res = await pool.query(sql, params);
  if (res.rowCount === 0) return null;
  return getBooking(businessId, id);
}

/**
 * Marks every reserved booking whose hold window has elapsed as expired.
 * Returns the ids of bookings that were expired.
 */
export async function expireStaleBookings(businessId) {
  const res = await pool.query(
    `UPDATE bookings SET status = 'expired', updated_at = CURRENT_TIMESTAMP,
       metadata = COALESCE(metadata, '{}'::jsonb) || '{"autoExpired": true}'::jsonb
     WHERE business_id = $1 AND status = 'reserved' AND hold_until IS NOT NULL AND hold_until <= CURRENT_TIMESTAMP
     RETURNING id`,
    [businessId]
  );
  return res.rows.map((r) => r.id);
}

/**
 * Atomic reschedule (correction C): locks the NEW slot, rechecks capacity over
 * the complete occupied interval excluding this booking, and moves it in the
 * same transaction. Returns { booking, moved } — moved is false when the
 * booking was not in a rescheduleable status. Throws
 * BookingConflictError('SLOT_NOT_AVAILABLE') when the destination is full.
 */
export async function rescheduleBooking({
  businessId, bookingId, config, newSlot,
  requireStatuses = ['reserved', 'confirmed'], now = new Date(),
}) {
  const lockKey = `${businessId}:${newSlot.start.toISOString()}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [lockKey]);

    const cur = await client.query(
      `SELECT id, status, requested_start_at, hold_until FROM bookings
       WHERE business_id = $1 AND id = $2 FOR UPDATE`,
      [businessId, bookingId]
    );
    if (cur.rows.length === 0) {
      await client.query('ROLLBACK');
      return { booking: null, moved: false };
    }
    const current = cur.rows[0];
    if (!requireStatuses.includes(current.status)) {
      await client.query('ROLLBACK');
      return { booking: null, moved: false };
    }

    const occupied = await countSlotOverlap(client, {
      businessId, productId: newSlot.productId, start: newSlot.start, end: newSlot.end,
      excludeBookingId: bookingId,
    });
    if (occupied >= config.capacity) {
      await client.query('ROLLBACK');
      throw new BookingConflictError('SLOT_NOT_AVAILABLE', 'This slot is no longer available.');
    }

    const patch = {
      reschedule: [{
        from: {
          requestedStartAt: current.requested_start_at.toISOString(),
          status: current.status,
        },
        to: {
          requestedStartAt: newSlot.start.toISOString(),
          endAt: newSlot.end.toISOString(),
          configVersion: config.config_version,
        },
      }],
    };
    const holdUntil = current.status === 'reserved'
      ? new Date(now.getTime() + config.hold_minutes * 60000)
      : null;
    await client.query(
      `UPDATE bookings SET requested_start_at = $1, end_at = $2,
         config_version = $3, hold_until = $4, updated_at = CURRENT_TIMESTAMP,
         metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb
       WHERE business_id = $6 AND id = $7`,
      [
        newSlot.start.toISOString(), newSlot.end.toISOString(),
        config.config_version, holdUntil, JSON.stringify(patch), businessId, bookingId,
      ]
    );
    await client.query('COMMIT');
    return { booking: await getBooking(businessId, bookingId), moved: true };
  } catch (e) {
    await client.query('ROLLBACK');
    if (e instanceof BookingConflictError) throw e;
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Merges a JSON patch into a commercial action's metadata (used by the BOOK
 * executor to record the resulting booking id without a new status cycle).
 */
export async function updateCommercialActionMetadata(businessId, id, patch) {
  const res = await pool.query(
    `UPDATE commercial_actions SET metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb, updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1 AND id = $2`,
    [businessId, id, JSON.stringify(patch)]
  );
  return res.rowCount > 0;
}
