/**
 * CHANNEL ADAPTER — WHATSAPP CLOUD API (real Meta integration)
 *
 * The internal channel boundary that lets the existing web/public TouchPoint
 * engine and WhatsApp share ONE sales engine. There is deliberately no second
 * WhatsApp-specific AI prompt or sales brain: a channel only decides how a
 * message arrives and leaves, never how the conversation is understood.
 *
 *   Inbound:  Meta webhook -> X-Hub-Signature-256 check -> resolve business by
 *             phone_number_id -> resolve/create conversation via channel
 *             identity -> the SAME conversation engine -> outbound response.
 *   Outbound: engine response -> sendWhatsAppMessage -> WhatsApp Cloud API.
 *
 * Outbound transport contract (production):
 *   - server-side Bearer token only (never exposed to the frontend);
 *   - bounded retries with exponential backoff for retry-able failures ONLY
 *     (HTTP 429, 5xx, network errors, or known transient Meta error codes);
 *   - permanent errors (HTTP 4xx, or permanent Meta codes) are surfaced
 *     immediately as a non-retryable WhatsAppProviderError so a business is
 *     never told a message was sent when it was not;
 *   - the provider message id returned by Meta is propagated so delivery/read
 *     status callbacks can be correlated later.
 *
 * No Meta credentials appear anywhere in source code; they arrive exclusively
 * from the deployment environment (see config/env.js).
 */
import axios from 'axios';
import { setTimeout as sleep } from 'node:timers/promises';

export const CHANNELS = Object.freeze({
  WEB: 'web',
  WHATSAPP: 'whatsapp',
});

export const SUPPORTED_CHANNELS = Object.freeze([CHANNELS.WEB, CHANNELS.WHATSAPP]);

/**
 * Normalizes and validates a channel label. Throws on anything unknown so a
 * bad channel can never silently fall back to web (which would misroute a
 * conversation's identity).
 */
export function assertChannel(value) {
  const channel = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SUPPORTED_CHANNELS.includes(channel)) {
    throw new Error(`Unsupported channel: ${value}`);
  }
  return channel;
}

/**
 * Deterministic channel-identity key: (business, channel, external customer id).
 * Two messages from the same sender on the same channel for the same business
 * always resolve to the same conversation; different senders/channels/tenants
 * never collide.
 */
export function channelIdentityKey({ businessId, channel, externalId }) {
  const c = assertChannel(channel);
  if (!businessId || typeof businessId !== 'string') throw new Error('businessId is required for channel identity');
  if (!externalId || typeof externalId !== 'string') throw new Error('externalId is required for channel identity');
  return `${businessId}:${c}:${externalId}`;
}

const META_GRAPH_BASE = 'https://graph.facebook.com/v19.0';
const MESSAGE_SEND_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;

/**
 * Transient Meta Cloud API error codes: retrying is safe and expected. Every
 * other non-network failure is treated as permanent (a 4xx response, or a
 * permanent Meta code) and is never retried.
 */
const RETRYABLE_META_ERROR_CODES = new Set([130429, 131056, 133010, 130462, 131052]);

export class WhatsAppProviderError extends Error {
  constructor(message, { status = null, retryable = false, code = null } = {}) {
    super(message);
    this.name = 'WhatsAppProviderError';
    this.status = status;
    this.retryable = !!retryable;
    this.code = code;
  }
}

function classifyAxiosError(error) {
  if (error instanceof WhatsAppProviderError) return error;
  if (error && error.response) {
    const status = error.response.status;
    let code = null;
    const body = error.response.data;
    if (body && typeof body === 'object' && body.error && typeof body.error.code === 'number') {
      code = body.error.code;
    }
    const retryable =
      status === 429 ||
      status >= 500 ||
      (code !== null && RETRYABLE_META_ERROR_CODES.has(code));
    return new WhatsAppProviderError(
      `WhatsApp Cloud API error (HTTP ${status}${code !== null ? `, code ${code}` : ''})`,
      { status, retryable, code }
    );
  }
  if (error && error.request) {
    return new WhatsAppProviderError('WhatsApp Cloud API request failed (network error or timeout)', {
      retryable: true,
    });
  }
  return new WhatsAppProviderError(error && error.message ? error.message : 'WhatsApp send failed', {
    retryable: false,
  });
}

/** Production transport: plain axios against the public Meta Graph API. */
async function defaultTransport({ url, accessToken, payload, timeoutMs }) {
  return axios.post(url, payload, {
    timeout: timeoutMs,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
}

// TEST SEAM: lets the suite substitute the provider HTTP transport without a
// network call. Production always uses the real Meta Graph API.
let overriddenTransport = null;
export function _setWhatsAppHttp(transportOrNull) {
  overriddenTransport = transportOrNull;
}

/**
 * Sends a text message over the WhatsApp Cloud API.
 *
 * Returns the provider message id so the caller can persist it and later
 * correlate Meta delivery/read/failed status callbacks. A message is only ever
 * reported as sent when Meta has accepted it (returned a message id).
 *
 * Retries are bounded and back off exponentially; only transient/network
 * failures are retried. Permanent provider errors throw a non-retryable
 * WhatsAppProviderError.
 */
export async function sendWhatsAppMessage({
  accessToken,
  phoneNumberId,
  to,
  text,
  timeoutMs = MESSAGE_SEND_TIMEOUT_MS,
  retryBackoffMs = null,
  transport = null,
}) {
  if (!accessToken || typeof accessToken !== 'string') {
    throw new Error('accessToken is required to send a WhatsApp message');
  }
  if (!phoneNumberId || typeof phoneNumberId !== 'string') {
    throw new Error('phoneNumberId is required to send a WhatsApp message');
  }
  if (typeof to !== 'string' || !to.trim() || to.length > 60) {
    throw new Error('whatsapp destination must be a non-empty string of 60 characters or fewer');
  }
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('text is required to send a WhatsApp message');
  }

  const http = transport || overriddenTransport || defaultTransport;
  const backoff = retryBackoffMs || ((attemptNumber) => 200 * 2 ** attemptNumber);
  const url = `${META_GRAPH_BASE}/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text },
  };

  async function attempt() {
    const response = await http({ url, accessToken, payload, timeoutMs });
    const data = response && response.data ? response.data : response;
    const providerMessageId = data && data.messages && Array.isArray(data.messages) && data.messages[0]
      ? data.messages[0].id
      : null;
    if (!providerMessageId) {
      throw new WhatsAppProviderError('Meta did not return a message id for the outbound message', {
        status: data && data.error && data.error.code ? null : 200,
        retryable: true,
      });
    }
    return { providerMessageId, raw: data };
  }

  let lastError = null;
  let attempts = 0;
  const maxAttempts = MAX_RETRIES + 1;
  while (attempts < maxAttempts) {
    try {
      return await attempt();
    } catch (err) {
      lastError = classifyAxiosError(err);
      if (!lastError.retryable) throw lastError;
      attempts += 1;
      if (attempts < maxAttempts) {
        await sleep(backoff(attempts));
      }
    }
  }
  throw lastError;
}