/**
 * BOOKING PROVIDER (Phase 13C)
 *
 * The native, server-authoritative booking provider. Pure logic over the
 * booking-time grid: it validates config payloads, signs/parses opaque slot
 * tokens, and defines the booking status life-cycle. It performs no database
 * I/O itself — storage, advisory-locked capacity checks and state transitions
 * live in db-pg.js — so every decision is deterministic and testable without a
 * DB dependency.
 *
 * Slot tokens bind (businessId, productId, start, end, config_version) and are
 * HMAC-SHA256-signed with the server secret. A config edit that affects
 * availability increments config_version, which invalidates previously issued
 * tokens (STALE_SLOT) instead of ever overbooking.
 */
import crypto from 'node:crypto';
import {
  isValidTimezone,
  operatingSession,
  normalizeBlackoutDates,
  BOOKING_CONSTRAINTS,
} from './booking-time.js';

export const BOOKING_STATUSES = Object.freeze({
  RESERVED: 'reserved',
  CONFIRMED: 'confirmed',
  COMPLETED: 'completed',
  NO_SHOW: 'no_show',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
});

export const BOOKING_STATUS_SET = new Set(Object.values(BOOKING_STATUSES));

// Statuses that continue to occupy a slot on the calendar.
export const OCCUPYING_STATUSES = Object.freeze([
  BOOKING_STATUSES.RESERVED,
  BOOKING_STATUSES.CONFIRMED,
]);

// Allowed lifecycle transitions (server-only; a request body can never set
// status directly).
export const BOOKING_TRANSITIONS = Object.freeze({
  [BOOKING_STATUSES.RESERVED]: [
    BOOKING_STATUSES.CONFIRMED,
    BOOKING_STATUSES.CANCELLED,
    BOOKING_STATUSES.EXPIRED,
  ],
  [BOOKING_STATUSES.CONFIRMED]: [
    BOOKING_STATUSES.COMPLETED,
    BOOKING_STATUSES.NO_SHOW,
    BOOKING_STATUSES.CANCELLED,
  ],
  [BOOKING_STATUSES.COMPLETED]: [],
  [BOOKING_STATUSES.NO_SHOW]: [],
  [BOOKING_STATUSES.CANCELLED]: [],
  [BOOKING_STATUSES.EXPIRED]: [],
});

export function canTransition(from, to) {
  return Array.isArray(BOOKING_TRANSITIONS[from]) && BOOKING_TRANSITIONS[from].includes(to);
}

function intInRange(value, fallback, min, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function booleanOrNull(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1) return true;
  if (value === 'false' || value === 0) return false;
  return null;
}

/**
 * Validates a booking-config candidate. Returns { value, error } with a
 * normalized config (all numbers bounded, hours normalized) or a client-safe
 * error message. Invalid operating hours never widen availability: a broken
 * session is rejected outright.
 */
export function normalizeBookingConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'booking config must be an object' };
  }

  const timezone = typeof raw.timezone === 'string' ? raw.timezone.trim() : '';
  if (!isValidTimezone(timezone)) {
    return { error: 'timezone must be a valid IANA timezone (e.g. Africa/Lagos)' };
  }

  const slotDuration = intInRange(raw.slot_duration_minutes, 30, BOOKING_CONSTRAINTS.slotDurationMin, BOOKING_CONSTRAINTS.slotDurationMax);
  if (slotDuration === null) {
    return { error: `slot_duration_minutes must be an integer between ${BOOKING_CONSTRAINTS.slotDurationMin} and ${BOOKING_CONSTRAINTS.slotDurationMax}` };
  }
  const buffer = intInRange(raw.buffer_minutes, 0, BOOKING_CONSTRAINTS.bufferMin, BOOKING_CONSTRAINTS.bufferMax);
  if (buffer === null) {
    return { error: `buffer_minutes must be an integer between ${BOOKING_CONSTRAINTS.bufferMin} and ${BOOKING_CONSTRAINTS.bufferMax}` };
  }
  const capacity = intInRange(raw.capacity, 1, BOOKING_CONSTRAINTS.capacityMin, BOOKING_CONSTRAINTS.capacityMax);
  if (capacity === null) {
    return { error: `capacity must be an integer between ${BOOKING_CONSTRAINTS.capacityMin} and ${BOOKING_CONSTRAINTS.capacityMax}` };
  }
  const minAdvanceHours = intInRange(raw.min_advance_hours, 1, BOOKING_CONSTRAINTS.minAdvanceHoursMin, BOOKING_CONSTRAINTS.minAdvanceHoursMax);
  if (minAdvanceHours === null) {
    return { error: `min_advance_hours must be an integer between ${BOOKING_CONSTRAINTS.minAdvanceHoursMin} and ${BOOKING_CONSTRAINTS.minAdvanceHoursMax}` };
  }
  const maxAdvanceDays = intInRange(raw.max_advance_days, 90, BOOKING_CONSTRAINTS.maxAdvanceDaysMin, BOOKING_CONSTRAINTS.maxAdvanceDaysMax);
  if (maxAdvanceDays === null) {
    return { error: `max_advance_days must be an integer between ${BOOKING_CONSTRAINTS.maxAdvanceDaysMin} and ${BOOKING_CONSTRAINTS.maxAdvanceDaysMax}` };
  }
  const holdMinutes = intInRange(raw.hold_minutes, 15, BOOKING_CONSTRAINTS.holdMinutesMin, BOOKING_CONSTRAINTS.holdMinutesMax);
  if (holdMinutes === null) {
    return { error: `hold_minutes must be an integer between ${BOOKING_CONSTRAINTS.holdMinutesMin} and ${BOOKING_CONSTRAINTS.holdMinutesMax}` };
  }

  const autoConfirm = booleanOrNull(raw.auto_confirm, true);
  const allowReschedule = booleanOrNull(raw.allow_reschedule, true);
  const requiresPayment = booleanOrNull(raw.requires_payment, false);
  if (autoConfirm === null || allowReschedule === null || requiresPayment === null) {
    return { error: 'auto_confirm, allow_reschedule and requires_payment must be booleans' };
  }

  const operatingHours = validateOperatingHours(raw.operating_hours);
  if (operatingHours.error) return { error: operatingHours.error };

  const blackout = normalizeBlackoutDates(raw.blackout_dates);
  if (blackout === null) {
    return { error: 'blackout_dates must be an array of YYYY-MM-DD strings' };
  }

  return {
    value: {
      timezone,
      slot_duration_minutes: slotDuration,
      buffer_minutes: buffer,
      capacity,
      operating_hours: operatingHours.value,
      blackout_dates: blackout,
      min_advance_hours: minAdvanceHours,
      max_advance_days: maxAdvanceDays,
      auto_confirm: autoConfirm,
      hold_minutes: holdMinutes,
      allow_reschedule: allowReschedule,
      requires_payment: requiresPayment,
    },
  };
}

function validateOperatingHours(raw) {
  if (raw === undefined || raw === null) return { value: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'operating_hours must be an object keyed by weekday (0-6) with { open, close } or "HH:MM-HH:MM" values' };
  }
  const keys = Object.keys(raw);
  if (keys.length === 0) return { value: {} };
  const normalized = {};
  for (const key of keys) {
    if (!/^[0-6]$/.test(key)) {
      return { error: 'operating_hours keys must be weekday numbers 0 (Sunday) through 6 (Saturday)' };
    }
    const session = operatingSession(raw, Number(key));
    if (!session) {
      return { error: `operating_hours["${key}"] is not a valid "HH:MM-HH:MM" or { open, close } session` };
    }
    normalized[key] = `${String(Math.floor(session.open / 60)).padStart(2, '0')}:${String(session.open % 60).padStart(2, '0')}-${String(Math.floor(session.close / 60)).padStart(2, '0')}:${String(session.close % 60).padStart(2, '0')}`;
  }
  return { value: normalized };
}

function toBase64Url(segment) {
  return Buffer.from(JSON.stringify(segment), 'utf8').toString('base64url');
}

function fromBase64Url(payload) {
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (err) {
    return null;
  }
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Signs an opaque, tamper-evident slot token binding business, product,
 * config_version and the exact occupied interval [start, end).
 */
export function issueSlotToken({ secret, businessId, productId, configVersion, start, end }) {
  const payload = toBase64Url({
    b: businessId,
    p: productId,
    v: configVersion,
    s: start.toISOString(),
    e: end.toISOString(),
  });
  return `${payload}.${sign(payload, secret).slice(0, 24)}`;
}

/**
 * Verifies a slot token and returns its decoded fields (businessId, productId,
 * configVersion, start, end as Dates) or null when malformed/unsigned.
 */
export function parseSlotToken({ secret, token }) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;
  const expected = sign(payload, secret).slice(0, 24);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) {
    return null;
  }
  const decoded = fromBase64Url(payload);
  if (!decoded) return null;
  const start = new Date(decoded.s);
  const end = new Date(decoded.e);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  if (!(end.getTime() > start.getTime())) return null;
  return {
    businessId: decoded.b,
    productId: decoded.p,
    configVersion: decoded.v,
    start,
    end,
  };
}