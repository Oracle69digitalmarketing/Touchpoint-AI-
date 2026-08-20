
import pg from 'pg';
import crypto from 'node:crypto';
import 'dotenv/config';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
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
    'SELECT id, name, slug, plan, created_at FROM businesses WHERE id = $1',
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
  c.target_language, c.created_at, c.updated_at,
  tp.name AS touchpoint_name, a.name AS agent_name
`;

export async function createConversation({ touchpoint, agentId, customerName, targetLanguage }) {
  const id = crypto.randomUUID();
  await pool.query(
    'INSERT INTO conversations (id, business_id, touchpoint_id, agent_id, customer_name, target_language) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, touchpoint.business_id, touchpoint.id, agentId, customerName || null, targetLanguage || 'en']
  );
  return getConversationById(id);
}

export async function getConversationById(id) {
  const res = await pool.query(`
    SELECT ${CONVERSATION_COLUMNS} FROM conversations c
    JOIN touchpoints tp ON tp.id = c.touchpoint_id
    JOIN agents a ON a.id = c.agent_id
    WHERE c.id = $1
  `, [id]);
  return res.rows[0] || null;
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
    JOIN touchpoints tp ON tp.id = c.touchpoint_id
    JOIN agents a ON a.id = c.agent_id
    WHERE c.business_id = $1
    ORDER BY c.updated_at DESC
  `, [businessId]);
  return res.rows;
}

/**
 * LEAD STORAGE
 */

const LEAD_COLUMNS = `
  l.id, l.business_id, l.touchpoint_id, l.conversation_id, l.agent_id,
  l.name, l.phone, l.email, l.intent, l.qualification_score,
  l.qualification_status, l.source, l.notified, l.created_at, l.updated_at,
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
