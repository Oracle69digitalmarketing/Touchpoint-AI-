/**
 * PHASE 13B: PAYMENT SERVICE
 *
 * Orchestrates the payment lifecycle on top of the provider-neutral
 * `payment-provider.js` adapters and the `payment_intents` ledger :
 *
 *   initializeOrderPayment   — the ONLY way an order enters pending_payment.
 *                              One transaction locks the order, enforces the
 *                              "one live pending intent per order" rule, then
 *                              talks to the provider outside the lock.
 *   settlePaymentFromEvent  — shared verified-settlement path used by webhooks
 *                             (and any future server-side verify poll). It
 *                             compares-and-sets BOTH the intent and the order.
 *   failPaymentFromEvent     — provider-reported failure/expiry: intent goes
 *                              terminal, order STAYS payable (payment_status mirrors
 *                              the last attempt), nothing cancels the order.
 *   handleProviderWebhook    — signature → parse → event ledger → settle.
 *
 * Settlement truth: an order becomes `paid` ONLY through settleOrderPayment
 * (db-pg), which runs after a verified provider webhook. No AI, client, or
 * callback path can call this.
 */
import crypto from 'node:crypto';
import { getProvider, ProviderError, WebhookError } from './payment-provider.js';
import { decimalToMinorUnits } from './money.js';
import {
  pool,
  getOrderById,
  setOrderStatus,
  setOrderPaymentStatus,
  createPaymentIntent,
  getPaymentIntentById,
  getPaymentIntentByReference,
  setPaymentIntentCheckout,
  setPaymentIntentStatus,
  settleOrderPayment,
  recordIntentFailure,
  recordWebhookEvent,
} from './db-pg.js';

function generateProviderReference() {
  return `TPO-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;
}

async function runInTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Creates (or reuses) the live payment intent for an order and pushes the
 * order into pending_payment. Everything about money is derived from the
 * order's stored total+currency; the request can only express provider choice,
 * an optional idempotency key, and a return URL.
 *
 * Returns:
 *   { created, intent, order }  on success;
 *   { error: { status, code, message } } for deterministic rejections
 *     (404 order missing, 409 order empty / not payable);
 *   throws ProviderError (502/503) when the provider cannot initialize —
 *     in which case the intent is voided and the order returns to draft so a
 *     retry is clean (spec §10.1 step 5).
 */
export async function initializeOrderPayment(
  businessId,
  orderId,
  { providerName = 'paystack', idempotencyKey = null, returnUrl = null, customer = null, metadata = null } = {}
) {
  const adapter = getProvider(providerName);

  const tx = await runInTransaction(async (client) => {
    const orderRes = await client.query(
      `SELECT id, status, payment_status, currency, total, conversation_id, business_id, customer_name
       FROM orders WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [orderId, businessId]
    );
    const order = orderRes.rows[0];
    if (!order) return { kind: 'not_found' };

    const countRes = await client.query(
      'SELECT COUNT(*)::int AS n FROM order_items WHERE order_id = $1',
      [orderId]
    );
    if (countRes.rows[0].n === 0) return { kind: 'empty' };

    const activeRes = await client.query(
      `SELECT id, business_id, order_id, provider, status, provider_reference,
              expected_amount_minor, currency, idempotency_key, checkout_metadata, metadata,
              failure_reason, paid_amount_minor, provider_event_id, verified_at, created_at, updated_at
       FROM payment_intents
       WHERE business_id = $1 AND order_id = $2 AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1
       FOR UPDATE`,
      [businessId, orderId]
    );
    const active = activeRes.rows[0];

    // Draft orders may always create a fresh intent. A pending_payment order is
    // payable too: either it already has a live intent (reused below) or every
    // previous intent is terminal (failed/expired) and a retry must be allowed.
    // Cancelled/paid/fulfilled are rejected.
    const payable = order.status === 'draft' || order.status === 'pending_payment';
    if (!payable) return { kind: 'invalid_transition', status: order.status };

    if (active) {
      active.expected_amount_minor = Number(active.expected_amount_minor);
      return { kind: 'reuse', intent: active };
    }

    const intentId = crypto.randomUUID();
    const providerReference = generateProviderReference();
    const expectedAmountMinor = decimalToMinorUnits(order.total, order.currency);

    const inserted = await client.query(
      `INSERT INTO payment_intents
         (id, business_id, order_id, provider, status, provider_reference,
          expected_amount_minor, currency, idempotency_key, checkout_metadata, metadata)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, '{}', $9)
       ON CONFLICT (order_id) WHERE status = 'pending' DO NOTHING
       RETURNING id`,
      [intentId, businessId, orderId, adapter.name, providerReference, expectedAmountMinor,
        order.currency, idempotencyKey || null,
        metadata && typeof metadata === 'object' ? JSON.stringify(metadata) : '{}']
    );
    // Safety net: the active-intent lock above already serialized callers, so a
    // conflict here means another writer created a pending intent first.
    if (!inserted.rows[0]) return { kind: 'stale' };

    const moved = await client.query(
      `UPDATE orders SET status = 'pending_payment', payment_status = 'pending', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND business_id = $2`,
      [orderId, businessId]
    );
    if (moved.rowCount === 0) return { kind: 'stale' };

    return { kind: 'create', intentId, providerReference, expectedAmountMinor, currency: order.currency, order };
  });

  if (tx.kind === 'not_found') {
    return { error: { status: 404, code: 'NOT_FOUND', message: 'Order not found' } };
  }
  if (tx.kind === 'empty') {
    return { error: { status: 409, code: 'ORDER_EMPTY', message: 'Order has no items' } };
  }
  if (tx.kind === 'invalid_transition') {
    return { error: { status: 409, code: 'INVALID_TRANSITION', message: `Order cannot be paid from ${tx.status}` } };
  }
  if (tx.kind === 'stale') {
    return { error: { status: 409, code: 'STALE_STATE', message: 'Order state changed while processing; retry' } };
  }

  if (tx.kind === 'reuse') {
    // Re-initializing the SAME reference under a valid signature, per §9.1.
    if (!tx.intent.checkout_metadata || !tx.intent.checkout_metadata.authorizationUrl) {
      const initiated = await adapter.initialize({
        providerReference: tx.intent.provider_reference,
        amountMinor: tx.intent.expected_amount_minor,
        currency: tx.intent.currency,
        customer,
        returnUrl,
        metadata: tx.intent.metadata,
      });
      await setPaymentIntentCheckout(businessId, tx.intent.id, initiated.checkout);
    }
    const intent = await getPaymentIntentById(businessId, tx.intent.id);
    const order = await getOrderById(businessId, orderId);
    return { created: false, intent, order };
  }

  // kind === 'create'
  let initiated;
  try {
    initiated = await adapter.initialize({
      providerReference: tx.providerReference,
      amountMinor: tx.expectedAmountMinor,
      currency: tx.currency,
      customer,
      returnUrl,
      metadata: tx.order && tx.order.metadata ? tx.order.metadata : {},
    });
  } catch (error) {
    // Clean retry contract: intent void, order back to draft (spec §10.1 step 5).
    const voided = await setPaymentIntentStatus(businessId, tx.intentId, 'void', 'pending', {
      failureReason: 'initialization_failed',
    });
    if (voided) {
      await setOrderStatus(businessId, orderId, 'draft', 'pending_payment');
      await setOrderPaymentStatus(businessId, orderId, 'unpaid');
    }
    throw error;
  }
  await setPaymentIntentCheckout(businessId, tx.intentId, initiated.checkout);

  const intent = await getPaymentIntentById(businessId, tx.intentId);
  const order = await getOrderById(businessId, orderId);
  return { created: true, intent, order };
}

/**
 * Verified-provider settlement (spec §8/§9). Reads the intent by provider
 * reference (never by any webhook body field), and hands the exact order +
 * intent to the atomic compare-and-set in db-pg. Both settlement and the
 * "already paid" no-op are transactional, so a different reference trying to
 * settle an already-paid order is a guaranteed no-op.
 */
export async function settlePaymentFromEvent({ provider, providerReference, type, eventId, amountMinor, currency }) {
  const intent = await getPaymentIntentByReference(provider, providerReference);
  if (!intent) return { outcome: 'unknown_reference' };
  if (type !== 'paid') {
    return { outcome: 'ignored', businessId: intent.business_id, intentId: intent.id };
  }
  if (intent.currency !== currency || intent.expected_amount_minor !== amountMinor) {
    const reason = intent.currency !== currency ? 'currency_mismatch' : 'amount_mismatch';
    const recorded = await recordIntentFailure({
      businessId: intent.business_id,
      orderId: intent.order_id,
      intentId: intent.id,
      intentStatus: 'failed',
      failureReason: reason,
      orderPaymentStatus: 'failed',
    });
    return {
      outcome: recorded.outcome === 'recorded' ? 'amount_or_currency_mismatch' : recorded.outcome,
      reason,
      businessId: intent.business_id,
      orderId: intent.order_id,
      intentId: intent.id,
    };
  }
  const result = await settleOrderPayment({
    businessId: intent.business_id,
    orderId: intent.order_id,
    intentId: intent.id,
    providerEventId: eventId,
    paidAmountMinor: amountMinor,
  });
  return { ...result, businessId: intent.business_id, orderId: intent.order_id, intentId: intent.id };
}

/**
 * Provider-reported failure/expiry (spec §7.4). Marks the intent terminal and
 * mirrors the attempt onto order.payment_status; the ORDER itself stays
 * `pending_payment` and is retryable through a fresh intent. It never cancels.
 */
export async function failPaymentFromEvent({ provider, providerReference, type }) {
  const intent = await getPaymentIntentByReference(provider, providerReference);
  if (!intent) return { outcome: 'unknown_reference' };
  const intentStatus = type === 'expired' ? 'expired' : 'failed';
  const orderPaymentStatus = type === 'expired' ? 'expired' : 'failed';
  const result = await recordIntentFailure({
    businessId: intent.business_id,
    orderId: intent.order_id,
    intentId: intent.id,
    intentStatus,
    failureReason: `provider:${type}`,
    orderPaymentStatus,
  });
  return { ...result, businessId: intent.business_id, orderId: intent.order_id, intentId: intent.id };
}

/**
 * Full inbound webhook pipeline. Strict order (spec §8):
 *   1. unknown provider        -> 400 (getProvider throws ProviderError 404,
 *                                  route normalizes; registry failures are 400);
 *   2. signature               -> 401 if invalid, BEFORE any parsing;
 *   3. parse                   -> 400 if signed-but-garbage;
 *   4. webhook_events ledger   -> ON CONFLICT DO NOTHING: the second delivery of
 *                                  the same event id ack 200 without touching state;
 *   5. settle / fail           -> atomic compare-and-set against the INTENT row.
 *
 * Returns `{ received: true, outcome }`. Throws ProviderError / WebhookError
 * for the 4xx/5xx cases above; everything actionable acks 200 (even unknown
 * references — no existence oracle, spec §7.2).
 */
export async function handleProviderWebhook({ providerName, rawBody, headers = {} }) {
  const adapter = getProvider(providerName);
  if (!adapter.verifyWebhookSignature(rawBody, headers)) {
    throw new WebhookError('Invalid webhook signature', 401);
  }
  const event = adapter.parseWebhook(rawBody, headers);

  if (event.type === 'ignored') {
    if (event.eventId) {
      await recordWebhookEvent({ eventId: event.eventId, eventType: event.rawEventType || 'ignored', businessId: null });
    }
    return { received: true, ignored: true, outcome: 'ignored' };
  }

  if (!event.eventId) {
    throw new WebhookError('Malformed webhook payload', 400);
  }
  if (event.type === 'paid') {
    if (!Number.isInteger(event.amountMinor) || !event.currency) {
      throw new WebhookError('Paid webhook missing settlement amount or currency', 400);
    }
  }
  if (!event.providerReference) {
    throw new WebhookError('Malformed webhook payload', 400);
  }

  const intent = await getPaymentIntentByReference(providerName, event.providerReference);
  const businessId = intent ? intent.business_id : null;

  const recordedEvent = await recordWebhookEvent({
    eventId: event.eventId,
    eventType: event.rawEventType,
    businessId,
  });
  if (!recordedEvent) {
    return { received: true, outcome: 'already_processed' };
  }

  const outcome = event.type === 'paid'
    ? await settlePaymentFromEvent({
        provider: providerName,
        providerReference: event.providerReference,
        type: event.type,
        eventId: event.eventId,
        amountMinor: event.amountMinor,
        currency: event.currency,
      })
    : await failPaymentFromEvent({
        provider: providerName,
        providerReference: event.providerReference,
        type: event.type,
      });

  return { received: true, outcome };
}