-- 008-booking.sql
-- Phase 13C deterministic booking infrastructure.
--
--   - products.bookable marks a catalog item as bookable (default false); a
--     product is never bookable until the business explicitly turns it on.
--   - booking_configs is the per-product booking policy. All scheduling math is
--     deterministic: operating hours and blackout dates are applied in the
--     configured IANA business timezone, slots are exact on the
--     (slot_duration + buffer) grid, and the capacity check covers the complete
--     occupied interval [requested_start, requested_end). Availability-affecting
--     edits bump config_version; slot tokens bind (business, product, start,
--     end, config_version), so an edited config makes previously issued tokens
--     STALE_SLOT instead of silently overbooking.
--   - bookings is the reservation ledger. Status is a server-controlled state
--     machine: reserved -> confirmed -> completed, reserved -> cancelled,
--     confirmed -> cancelled, reserved -> expired. Confirmed is never granted
--     by the AI or a client; only the server performs transitions.
--   - Idempotent reservation: UNIQUE (business_id, idempotency_key) WHERE
--     idempotency_key IS NOT NULL lets a retried client request return the
--     existing booking instead of double-reserving.
--
-- Backward compatible: additive only; every existing row and table is
-- untouched. product.bookable defaults to false, so no existing product
-- becomes bookable.
--
-- Idempotent (IF NOT EXISTS / guarded ADD COLUMN and indexes) so it can run
-- safely on databases already initialized from schema-pg.sql, which includes
-- the same objects.

ALTER TABLE products ADD COLUMN IF NOT EXISTS bookable BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS booking_configs (
  id                    TEXT PRIMARY KEY,
  business_id           TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id            TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  timezone              TEXT NOT NULL,
  slot_duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (slot_duration_minutes BETWEEN 5 AND 480),
  buffer_minutes        INTEGER NOT NULL DEFAULT 0 CHECK (buffer_minutes BETWEEN 0 AND 1440),
  capacity              INTEGER NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 100),
  operating_hours       JSONB NOT NULL DEFAULT '{}',
  blackout_dates        JSONB NOT NULL DEFAULT '[]',
  min_advance_hours     INTEGER NOT NULL DEFAULT 1 CHECK (min_advance_hours >= 0),
  max_advance_days      INTEGER NOT NULL DEFAULT 90 CHECK (max_advance_days BETWEEN 1 AND 365),
  auto_confirm          BOOLEAN NOT NULL DEFAULT TRUE,
  hold_minutes          INTEGER NOT NULL DEFAULT 15 CHECK (hold_minutes BETWEEN 1 AND 1440),
  allow_reschedule      BOOLEAN NOT NULL DEFAULT TRUE,
  requires_payment      BOOLEAN NOT NULL DEFAULT FALSE,
  config_version        BIGINT NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (product_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_configs_business ON booking_configs(business_id);
CREATE INDEX IF NOT EXISTS idx_booking_configs_product ON booking_configs(product_id);

CREATE TABLE IF NOT EXISTS bookings (
  id                 TEXT PRIMARY KEY,
  business_id        TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id         TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  conversation_id    TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  lead_id            TEXT REFERENCES leads(id) ON DELETE SET NULL,
  order_id           TEXT REFERENCES orders(id) ON DELETE SET NULL,
  customer           JSONB NOT NULL DEFAULT '{}',
  name               TEXT,
  phone              TEXT,
  email              TEXT,
  timezone           TEXT NOT NULL,
  duration_minutes   INTEGER NOT NULL CHECK (duration_minutes > 0),
  requested_start_at TIMESTAMPTZ NOT NULL,
  end_at             TIMESTAMPTZ NOT NULL,
  status             TEXT NOT NULL DEFAULT 'reserved',
  idempotency_key    TEXT,
  config_version     BIGINT NOT NULL,
  hold_until         TIMESTAMPTZ,
  metadata           JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_at > requested_start_at)
);

CREATE INDEX IF NOT EXISTS idx_bookings_business ON bookings(business_id, requested_start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_product_time ON bookings(product_id, requested_start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(business_id, status, requested_start_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_idempotency
  ON bookings(business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;