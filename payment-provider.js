/**
 * PHASE 13B: PAYMENT PROVIDER ABSTRACTION
 *
 * The provider-neutral boundary that keeps core order/payment logic decoupled
 * from any single PSP. Core logic talks to `getProvider(name)` only.
 *
 * Each adapter implements a small, symmetric contract:
 *   - `initialize(...)` — create a new checkout for a server-generated reference;
 *   - `verify(reference)` — ask the provider about a reference's final state;
 *   - `verifyWebhookSignature(rawBody, headers)` — cryptographically verify an
 *     inbound webhook; false means REJECT (401), never "proceed";
 *   - `parseWebhook(rawBody, headers)` — normalize a signed payload to a
 *     canonical event: { eventId, rawEventType, type, providerReference,
 *     amountMinor, currency }.
 *
 * The Paystack adapter is deliberately wired without an SDK: the initialize /
 * verify HTTP calls are plain axios against the public API, identical to the
 * billing seam used since Phase 7, and injected as a transport seam so tests
 * can fake it deterministically without any live credential.
 */
import crypto from 'node:crypto';
import axios from 'axios';
import { config } from './config/env.js';

const PAYSTACK_API_BASE = 'https://api.paystack.co';

/** Provider-facing failure (network, reject, unconfigured secret). */
export class ProviderError extends Error {
  constructor(message, { status = 502 } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}

/** Malformed signed webhook payload. Carries the HTTP status to respond with. */
export class WebhookError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'WebhookError';
    this.status = status;
  }
}

function timingSafeEqualHex(left, right) {
  const a = Buffer.from(String(left), 'utf8');
  const b = Buffer.from(String(right), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Default Paystack HTTP transport. Replaced wholesale by tests via
 * `_setPaystackHttp` — production always uses the real API.
 */
function defaultPaystackHttp() {
  const authHeaders = (secret) => ({ Authorization: `Bearer ${secret}` });

  return {
    async initialize({ secret, amount, email, currency, reference, callbackUrl }) {
      const payload = { amount, email, currency, reference };
      if (callbackUrl) payload.callback_url = callbackUrl;
      const response = await axios.post(`${PAYSTACK_API_BASE}/transaction/initialize`, payload, {
        headers: { ...authHeaders(secret), 'Content-Type': 'application/json' },
        timeout: 10000,
      });
      return response.data;
    },
    async verify({ secret, reference }) {
      const response = await axios.get(
        `${PAYSTACK_API_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
        { headers: authHeaders(secret), timeout: 10000 }
      );
      return response.data;
    },
  };
}

let paystackHttp = defaultPaystackHttp();

/** TEST SEAM: swap the Paystack HTTP transport (mirrors `_setPaystackClient`). */
export function _setPaystackHttp(http) {
  paystackHttp = http || defaultPaystackHttp();
}

// Canonical state per Paystack charge event type. Everything else is `ignored`
// (invoice.*, transfer.*, ...) and never touches order state.
const PAYSTACK_EVENT_TYPES = Object.freeze({
  'charge.success': 'paid',
  'charge.failed': 'failed',
  'charge.abandoned': 'expired',
});

const PAYSTACK_CHARGE_STATUS_TO_TYPE = Object.freeze({
  success: 'paid',
  failed: 'failed',
  abandoned: 'failed',
});

class PaystackAdapter {
  get name() {
    return 'paystack';
  }

  /** The original Paystack event is the authoritative replay guard (no signed payload timestamp). */
  get supportsTimestampReplayGuard() {
    return false;
  }

  async initialize({ providerReference, amountMinor, currency, customer = null, returnUrl = null, metadata = {} }) {
    const secret = config.paystackSecretKey;
    if (!secret) {
      throw new ProviderError('PAYSTACK_SECRET_KEY is not configured', { status: 503 });
    }
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      throw new ProviderError('Invalid settlement amount');
    }
    if (!currency || typeof currency !== 'string') {
      throw new ProviderError('Invalid settlement currency');
    }
    const email = (customer && customer.email) || 'orders@touchpoint.local';

    let result;
    try {
      result = await paystackHttp.initialize({
        secret,
        amount: amountMinor,
        email,
        currency,
        reference: providerReference,
        callbackUrl: returnUrl,
      });
    } catch (error) {
      throw new ProviderError(`Paystack initialization failed: ${error.message}`);
    }
    if (!result || result.status !== true || !result.data || !result.data.reference) {
      throw new ProviderError('Paystack initialization rejected');
    }
    return {
      providerReference: result.data.reference,
      checkout: {
        providerReference: result.data.reference,
        authorizationUrl: result.data.authorization_url || null,
        accessCode: result.data.access_code || null,
      },
    };
  }

  async verify(reference) {
    const secret = config.paystackSecretKey;
    let result;
    try {
      result = await paystackHttp.verify({ secret, reference });
    } catch (error) {
      throw new ProviderError(`Paystack verification failed: ${error.message}`);
    }
    if (!result || typeof result.status !== 'boolean') {
      throw new ProviderError('Paystack verification rejected');
    }
    const data = result.data || {};
    const chargeStatus = typeof data.status === 'string' ? data.status.toLowerCase() : 'unknown';
    const type = PAYSTACK_CHARGE_STATUS_TO_TYPE[chargeStatus] || 'pending';
    return {
      type,
      paid: type === 'paid',
      amountMinor: Number.isInteger(data.amount) ? data.amount : null,
      currency: typeof data.currency === 'string' ? data.currency.toUpperCase() : null,
    };
  }

  verifyWebhookSignature(rawBody, headers = {}) {
    const source =
      headers['x-paystack-signature'] ||
      headers['X-Paystack-Signature'] ||
      headers['xpaystacksignature'] ||
      '';
    if (typeof source !== 'string' || !source.trim()) return false;
    if (rawBody === undefined || rawBody === null) return false;
    const secret = config.paystackSecretKey;
    if (!secret) return false;
    const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
    const expected = crypto.createHmac('sha512', secret).update(body, 'utf8').digest('hex');
    return timingSafeEqualHex(expected, source.trim());
  }

  parseWebhook(rawBody, headers = {}) {
    if (rawBody === undefined || rawBody === null) throw new WebhookError('Missing body', 400);
    if (typeof rawBody !== 'string' && !Buffer.isBuffer(rawBody)) throw new WebhookError('Invalid body', 400);
    let parsed;
    try {
      parsed = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody);
    } catch {
      throw new WebhookError('Invalid JSON body', 400);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new WebhookError('Malformed webhook payload', 400);
    }
    const event = typeof parsed.event === 'string' ? parsed.event : null;
    const data = parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data) ? parsed.data : {};

    const eventId = typeof data.id === 'string' && data.id ? data.id : null;
    const providerReference = typeof data.reference === 'string' && data.reference ? data.reference : null;
    const amountMinor = Number.isInteger(data.amount) ? data.amount : null;
    const currency = typeof data.currency === 'string' && data.currency ? data.currency.toUpperCase() : null;
    const rawEventType = event;

    if (!eventId && !providerReference && !event) {
      throw new WebhookError('Malformed webhook payload', 400);
    }

    return {
      eventId,
      rawEventType,
      type: (rawEventType && PAYSTACK_EVENT_TYPES[rawEventType]) || 'ignored',
      providerReference,
      amountMinor,
      currency,
    };
  }
}

const PROVIDERS = Object.freeze({
  paystack: new PaystackAdapter(),
});

export function getProvider(name) {
  if (!name || typeof name !== 'string') {
    throw new ProviderError('provider name is required', { status: 400 });
  }
  const adapter = PROVIDERS[String(name).toLowerCase()];
  if (!adapter) {
    throw new ProviderError(`Unknown payment provider: ${name}`, { status: 404 });
  }
  return adapter;
}

export const PROVIDER_NAMES = Object.freeze(Object.keys(PROVIDERS));