/**
 * CHANNEL ADAPTER (Phase 13A)
 *
 * The internal channel boundary that lets the existing web/public TouchPoint
 * engine and a future WhatsApp engine share ONE sales engine. There is
 * deliberately no second WhatsApp-specific AI prompt or sales brain: a channel
 * only decides how a message arrives and leaves, never how the conversation is
 * understood.
 *
 * Boundary for the future WhatsApp Cloud API:
 *
 *   Inbound:  Meta webhook -> signature/verify-token check -> resolve business
 *             -> resolve/create conversation via channel identity -> the SAME
 *             conversation engine -> outbound response.
 *   Outbound: engine response -> this adapter -> WhatsApp Cloud API.
 *
 * Phase 13A implements ONLY the internal abstraction and a clearly-labeled MOCK
 * outbound. No Meta credentials, tokens, SDK calls, or secrets appear anywhere
 * in source code; provider credentials will arrive from the deployment
 * environment when real WhatsApp integration begins.
 */

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

/**
 * MOCK outbound channel. Sends nothing anywhere: the WhatsApp branch only
 * validates the destination and reports the provider this phase will wire in
 * later. The real Meta Cloud API call (and its credential plumbing) replaces
 * the body of the whatsapp branch in a later phase — nothing else in the app
 * changes, because every other caller talks to this function.
 */
export function sendChannelMessage({ channel, destination, text }) {
  const c = assertChannel(channel);
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('text is required to send a channel message');
  }
  if (c === CHANNELS.WHATSAPP) {
    if (typeof destination !== 'string' || !destination.trim() || destination.length > 60) {
      throw new Error('whatsapp destination must be a non-empty string of 60 characters or fewer');
    }
    return { ok: true, channel: c, provider: 'mock', note: 'WhatsApp Cloud API integration not yet wired; this is the Phase 13A mock adapter.' };
  }
  return { ok: true, channel: c, provider: 'native' };
}