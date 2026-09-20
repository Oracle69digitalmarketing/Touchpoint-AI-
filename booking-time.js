/**
 * BOOKING TIME (Phase 13C)
 *
 * Deterministic scheduling math for the native booking provider. Pure: no
 * database access, no randomness. All computations are reproducible given the
 * same inputs, so the server (not the AI) is the single source of truth for
 * what slot exists and when a request may be honored.
 *
 * Conventions:
 *   - Booking configs carry an IANA timezone. Storage timestamps are always
 *     UTC instants (TIMESTAMPTZ); only grid/slot math and human labels use the
 *     business timezone.
 *   - operating_hours is JSON: empty object `{}` = open 24/7; otherwise a map
 *     from JS weekday (0=Sunday..6=Saturday) to a session `{ open, close }`
 *     ("HH:MM" local) or a "HH:MM-HH:MM" string. A weekday key that is absent
 *     means the business is closed that day.
 *   - blackout_dates is a JSON array of local "YYYY-MM-DD" dates (closed).
 *   - Slots are exact on the (slot_duration_minutes + buffer_minutes) grid,
 *     aligned to the local day. The occupied interval is
 *     [start, start + duration + buffer); capacity checks and tokens use that
 *     complete interval so a booked product is never double-booked across
 *     buffer padding.
 *   - Advance bounds: a slot may only be reserved when its start is at least
 *     min_advance_hours and at most max_advance_days ahead of the reservation
 *     instant (measured in UTC).
 */

const DAY_MILLIS = 86400000;

function makeFormatter(tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
  return { dtf, wd };
}

function partsOf(dtf, instant) {
  const map = {};
  for (const p of dtf.formatToParts(instant)) map[p.type] = p.value;
  return map;
}

export function utcOffsetMinutes(tz, instant) {
  const { dtf } = formattersFor(tz);
  const p = partsOf(dtf, instant);
  const asUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second)
  );
  return Math.round((asUTC - instant.getTime()) / 60000);
}

const formatterCache = new Map();
function formattersFor(tz) {
  let entry = formatterCache.get(tz);
  if (!entry) {
    entry = makeFormatter(tz);
    formatterCache.set(tz, entry);
  }
  return entry;
}

export function isValidTimezone(tz) {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    partsOf(formattersFor(tz).dtf, Date.now());
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Local wall clock -> UTC instant for a given IANA zone. Offset-corrected
 * iteratively so DST transitions resolve deterministically (a day that starts
 * at 00:00 local always maps to the same instant regardless of DST rules).
 */
export function localToUtc(tz, year, monthIndex, day, hour, minute) {
  const base = Date.UTC(year, monthIndex, day, hour, minute);
  let instantMs = base;
  for (let i = 0; i < 4; i++) {
    instantMs = base - utcOffsetMinutes(tz, new Date(instantMs)) * 60000;
  }
  return new Date(instantMs);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Business-local calendar date key ("YYYY-MM-DD") of a UTC instant.
 */
export function localDateKey(instant, tz) {
  const { dtf } = formattersFor(tz);
  const p = partsOf(dtf, instant);
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * JS weekday number (0=Sunday..6=Saturday) of a UTC instant in business tz.
 */
export function localWeekday(instant, tz) {
  const { wd } = formattersFor(tz);
  const label = wd.format(instant);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[label] ?? 0;
}

function addLocalDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n, 12, 0, 0));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function toMinutes(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

function sessionOf(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const parts = raw.split('-').map((s) => s.trim());
    if (parts.length !== 2) return null;
    const open = toMinutes(parts[0]);
    const close = toMinutes(parts[1]);
    if (open === null || close === null || close <= open) return null;
    return { open, close };
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const open = toMinutes(raw.open);
    const close = toMinutes(raw.close);
    if (open === null || close === null || close <= open) return null;
    return { open, close };
  }
  return null;
}

/**
 * Validates and normalizes operating_hours.
 * Returns { open, close } for a weekday, or null when that day is closed.
 * An empty object means open 24/7. Invalid sessions are treated as closed
 * (never silently widened).
 */
export function operatingSession(operatingHours, weekday) {
  if (!operatingHours || typeof operatingHours !== 'object' || Array.isArray(operatingHours)) {
    return null;
  }
  const keys = Object.keys(operatingHours);
  if (keys.length === 0) return { open: 0, close: 1440 };
  return sessionOf(operatingHours[weekday]) || null;
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeBlackoutDates(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const dates = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || !DATE_KEY_RE.test(entry)) return null;
    dates.push(entry);
  }
  return dates;
}

/**
 * Deterministic exact slots on the (duration + buffer) grid between the
 * advance bounds. `nowUtc` is the authoritative "now"; `fromUtc` (optional)
 * nudges the window forward but never before now + min_advance_hours.
 * Returns at most `count` slots in chronological order:
 *   { start: Date(utc), end: Date(utc), durationMinutes, localStart, localEnd }
 * localStart/localEnd are human labels in the business timezone.
 */
export function availableSlots({ config, nowUtc, fromUtc = null, count = 10 }) {
  const tz = config.timezone;
  const step = config.slot_duration_minutes + config.buffer_minutes;
  const occupied = config.slot_duration_minutes + config.buffer_minutes;
  const blackout = new Set(config.blackout_dates || []);

  const now = nowUtc instanceof Date ? nowUtc : new Date(nowUtc || Date.now());
  const earliest = new Date(now.getTime() + config.min_advance_hours * 3600000);
  const horizon = new Date(now.getTime() + config.max_advance_days * DAY_MILLIS);
  const startPoint = fromUtc
    ? new Date(Math.max(fromUtc.getTime(), earliest.getTime()))
    : earliest;

  const slots = [];
  let key = localDateKey(startPoint, tz);
  const horizonKey = localDateKey(horizon, tz);
  const guard = 370;

  for (let days = 0; days < guard && slots.length < count; days++) {
    if (key > horizonKey) break;
    if (!blackout.has(key)) {
      const [y, m, d] = key.split('-').map(Number);
      const dayStart = localToUtc(tz, y, m - 1, d, 0, 0);
      const session = operatingSession(config.operating_hours, localWeekday(dayStart, tz));
      if (session && step <= session.close - session.open) {
        for (let startMin = session.open; startMin + occupied <= session.close; startMin += step) {
          const start = localToUtc(tz, y, m - 1, d, Math.floor(startMin / 60), startMin % 60);
          const end = new Date(start.getTime() + occupied * 60000);
          if (start.getTime() < startPoint.getTime()) continue;
          if (start.getTime() > horizon.getTime()) break;
          slots.push({
            start,
            end,
            durationMinutes: config.slot_duration_minutes,
            localStart: localClockLabel(start, tz),
            localEnd: localClockLabel(end, tz),
            localDate: localDateKey(start, tz),
          });
          if (slots.length >= count) break;
        }
      }
    }
    key = addLocalDays(key, 1);
  }
  return slots;
}

function localClockLabel(instant, tz) {
  const { dtf } = formattersFor(tz);
  const p = partsOf(dtf, instant);
  return `${pad(Number(p.hour) % 24)}:${p.minute}`;
}

/**
 * Exact-slot predicate. True only when [start, end) lies exactly on the booked
 * grid for the business timezone (correct weekday, inside an operating session,
 * start aligned to open + k*step, and the full occupied interval fits) AND the
 * date is not blacked out. Time alignment is checked against the business-local
 * clock so tests in any IANA zone remain deterministic.
 */
export function isExactSlot({ config, start, end, nowUtc = null }) {
  const tz = config.timezone;
  const step = config.slot_duration_minutes + config.buffer_minutes;
  const occupied = config.slot_duration_minutes + config.buffer_minutes;
  const blackout = new Set(config.blackout_dates || []);

  const startInstant = start instanceof Date ? start : new Date(start);
  const endInstant = end instanceof Date ? end : new Date(end);
  if (!(endInstant.getTime() - startInstant.getTime() === occupied * 60000)) return false;

  const { dtf } = formattersFor(tz);
  const p = partsOf(dtf, startInstant);
  const y = Number(p.year);
  const mo = Number(p.month) - 1;
  const d = Number(p.day);
  const tod = (Number(p.hour) % 24) * 60 + Number(p.minute);

  const dateKey = `${p.year}-${p.month}-${p.day}`;
  if (blackout.has(dateKey)) return false;

  const dayStart = localToUtc(tz, y, mo, d, 0, 0);
  const session = operatingSession(config.operating_hours, localWeekday(dayStart, tz));
  if (!session) return false;
  if (tod < session.open) return false;
  if (tod + occupied > session.close) return false;
  if ((tod - session.open) % step !== 0) return false;

  if (nowUtc) {
    const now = nowUtc instanceof Date ? nowUtc : new Date(nowUtc);
    if (startInstant.getTime() < now.getTime() + config.min_advance_hours * 3600000) return false;
    if (startInstant.getTime() > now.getTime() + config.max_advance_days * DAY_MILLIS) return false;
  }
  return true;
}

export const BOOKING_CONSTRAINTS = Object.freeze({
  slotDurationMin: 5,
  slotDurationMax: 480,
  bufferMin: 0,
  bufferMax: 1440,
  capacityMin: 1,
  capacityMax: 100,
  minAdvanceHoursMin: 0,
  minAdvanceHoursMax: 720,
  maxAdvanceDaysMin: 1,
  maxAdvanceDaysMax: 365,
  holdMinutesMin: 1,
  holdMinutesMax: 1440,
});