-- Phase 2A: TouchPoint AI PostgreSQL Schema
-- Targets Supabase PostgreSQL. 
-- Preserves existing UUIDs as strings (TEXT) to match current JS generation logic.
-- Translates SQLite INTEGER booleans to native BOOLEAN.
-- Translates SQLite TEXT timestamps to TIMESTAMPTZ.
-- Ensures chronological message ordering with an identity column.

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABLES

CREATE TABLE IF NOT EXISTS businesses (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  plan       TEXT NOT NULL DEFAULT 'Free',
  whatsapp   TEXT,
  phone      TEXT,
  email      TEXT,
  booking_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id                      TEXT PRIMARY KEY,
  business_id             TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email                   TEXT NOT NULL UNIQUE,
  password_hash           TEXT NOT NULL,
  name                    TEXT NOT NULL,
  role                    TEXT NOT NULL DEFAULT 'owner',
  email_verified          BOOLEAN NOT NULL DEFAULT FALSE,
  verification_token      TEXT,
  verification_expires_at TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agents (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'Active',
  industry        TEXT NOT NULL DEFAULT 'General',
  voice           TEXT NOT NULL DEFAULT 'professional',
  description     TEXT,
  service_catalog TEXT,
  client_profiles TEXT,
  case_library    TEXT,
  guidelines      TEXT,
  documents       JSONB NOT NULL DEFAULT '[]', -- JSONB for better performance
  leads_generated INTEGER NOT NULL DEFAULT 0,
  conversion_rate REAL NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS touchpoints (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  location    TEXT NOT NULL DEFAULT '',
  tracking_id TEXT NOT NULL UNIQUE,
  scans       INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS touchpoint_scans (
  id           TEXT PRIMARY KEY,
  touchpoint_id TEXT NOT NULL REFERENCES touchpoints(id) ON DELETE CASCADE,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  touchpoint_id   TEXT REFERENCES touchpoints(id) ON DELETE SET NULL,
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  customer_name   TEXT,
  target_language TEXT NOT NULL DEFAULT 'en',
  channel         TEXT NOT NULL DEFAULT 'web',
  stage           TEXT NOT NULL DEFAULT 'engage',
  intent          TEXT,
  customer_need   TEXT,
  recommended_product_id TEXT,
  buying_signal   BOOLEAN NOT NULL DEFAULT FALSE,
  objection       TEXT,
  contact_declined BOOLEAN NOT NULL DEFAULT FALSE,
  questions_asked JSONB NOT NULL DEFAULT '[]',
  captured_lead_fields JSONB NOT NULL DEFAULT '{}',
  next_best_action TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Structured product/service catalog (Batch 2). Authoritative when any rows
-- exist for a business; the legacy free-text agents.service_catalog remains
-- the compatibility fallback until structured products are configured.
CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  category    TEXT,
  price       NUMERIC(14, 2) NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL DEFAULT 'NGN',
  status      TEXT NOT NULL DEFAULT 'active',
  bookable    BOOLEAN NOT NULL DEFAULT false,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_conversations_recommended_product') THEN
        ALTER TABLE conversations
        ADD CONSTRAINT fk_conversations_recommended_product
        FOREIGN KEY (recommended_product_id) REFERENCES products(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS conversation_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  text            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  seq             BIGSERIAL -- Explicit ordering column to replace SQLite rowid
);

CREATE TABLE IF NOT EXISTS leads (
  id                   TEXT PRIMARY KEY,
  business_id          TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  touchpoint_id        TEXT REFERENCES touchpoints(id) ON DELETE SET NULL,
  conversation_id      TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  agent_id             TEXT REFERENCES agents(id) ON DELETE SET NULL,
  name                 TEXT,
  phone                TEXT,
  email                TEXT,
  intent               TEXT,
  qualification_score  INTEGER NOT NULL DEFAULT 0,
  qualification_status TEXT NOT NULL DEFAULT 'pending',
  source               TEXT NOT NULL DEFAULT 'auto',
  notified             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lead_notifications (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  lead_id     TEXT NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Commercial transaction foundation (Phase 13A): deterministic orders, order
-- lines, validated commercial-action proposals, and channel identity/config.
-- Payment state can only ever be changed by verified payment-provider events;
-- the LLM cannot mark an order PAID or fulfilled.

CREATE TABLE IF NOT EXISTS orders (
  id                 TEXT PRIMARY KEY,
  business_id        TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id    TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  lead_id            TEXT REFERENCES leads(id) ON DELETE SET NULL,
  channel            TEXT NOT NULL DEFAULT 'web',
  customer_name      TEXT,
  status             TEXT NOT NULL DEFAULT 'draft',
  currency           TEXT NOT NULL DEFAULT 'NGN',
  subtotal           NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total              NUMERIC(14, 2) NOT NULL DEFAULT 0,
  payment_status     TEXT NOT NULL DEFAULT 'unpaid',
  fulfillment_status TEXT NOT NULL DEFAULT 'unfulfilled',
  metadata           JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price  NUMERIC(14, 2) NOT NULL CHECK (unit_price >= 0),
  total       NUMERIC(14, 2) NOT NULL CHECK (total >= 0),
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (order_id, product_id)
);

-- Validated commercial-action proposals. The AI may propose an action; only the
-- server may execute one, and only after deterministic validation. Status is a
-- server-controlled state machine (proposed -> executed | rejected); no request
-- body can ever set it.
CREATE TABLE IF NOT EXISTS commercial_actions (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  action_type     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'proposed',
  lead_id         TEXT REFERENCES leads(id) ON DELETE SET NULL,
  product_id      TEXT REFERENCES products(id) ON DELETE SET NULL,
  order_id        TEXT REFERENCES orders(id) ON DELETE SET NULL,
  customer        JSONB NOT NULL DEFAULT '{}',
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Deterministic channel identity: one (business, channel, external customer id)
-- maps to one conversation, and therefore to the shared sales engine.
CREATE TABLE IF NOT EXISTS channel_identities (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL,
  external_id     TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, channel, external_id)
);

-- Business-level channel configuration. PUBLIC settings only (enabled, status,
-- display name, Meta phone number id). Provider credentials/secrets belong to
-- the deployment environment, never to source code, seeds, logs, frontend, or
-- this table. `phone_number_id` binds the business's WhatsApp channel to a Meta
-- phone number id; the unique partial index makes inbound resolution
-- unambiguous (one Meta number -> exactly one tenant).
CREATE TABLE IF NOT EXISTS channel_config (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL,
  enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  status       TEXT NOT NULL DEFAULT 'not_configured',
  display_name TEXT NOT NULL DEFAULT 'WhatsApp',
  phone_number_id TEXT,
  provider_business_account_id TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, channel)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_config_phone_number_id
  ON channel_config(phone_number_id) WHERE phone_number_id IS NOT NULL;

-- WhatsApp message ledger (real Meta Cloud API channel). Inbound messages are
-- persisted with their Meta wa_message_id so duplicate webhook deliveries are
-- idempotent; outbound messages carry the normalized provider status
-- (queued -> sent -> delivered -> read, or failed) which is only ever advanced
-- by Meta status callbacks. message_type + reserved media JSONB let future
-- media land in the ledger safely; unsupported types are stored, never
-- pretended to be handled.
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id               TEXT PRIMARY KEY,
  business_id      TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id  TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  direction        TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  wa_message_id    TEXT,
  status           TEXT NOT NULL DEFAULT 'queued',
  message_type     TEXT NOT NULL DEFAULT 'text',
  customer_phone   TEXT,
  body             TEXT,
  media            JSONB NOT NULL DEFAULT '{}',
  provider_error   TEXT,
  payload          JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_messages_wa_message_id
  ON whatsapp_messages(wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_business ON whatsapp_messages(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversation ON whatsapp_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_status ON whatsapp_messages(business_id, status, created_at);

-- Payment intents (Phase 13B): the provider-neutral settlement ledger. At most
-- one live 'pending' intent per order (partial unique index), and a provider
-- reference maps to exactly one intent. All amounts here are exact integer
-- minor units; the decimal order total is converted once upstream. Only a
-- verified provider event can move an intent to 'succeeded' and thereby settle
-- its exact order (settleOrderPayment in db-pg enforces both atomically).
CREATE TABLE IF NOT EXISTS payment_intents (
  id                     TEXT PRIMARY KEY,
  business_id            TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_id               TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider               TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending',
  provider_reference     TEXT NOT NULL,
  expected_amount_minor  INTEGER NOT NULL CHECK (expected_amount_minor > 0),
  currency               TEXT NOT NULL,
  idempotency_key        TEXT,
  checkout_metadata      JSONB NOT NULL DEFAULT '{}',
  metadata               JSONB NOT NULL DEFAULT '{}',
  failure_reason         TEXT,
  paid_amount_minor      INTEGER,
  provider_event_id      TEXT,
  verified_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, provider_reference)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_intents_one_active_per_order
  ON payment_intents(order_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_payment_intents_business ON payment_intents(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_intents_order ON payment_intents(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_provider_reference ON payment_intents(provider, provider_reference);
CREATE INDEX IF NOT EXISTS idx_payment_intents_idempotency
  ON payment_intents(business_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Deterministic booking infrastructure (Phase 13C). A product becomes bookable
-- only when the business explicitly turns it on; the booking policy lives in
-- booking_configs and every scheduling decision is server-computed. Booking
-- status (reserved/confirmed/completed/no_show/cancelled/expired) is a
-- server-controlled state machine — the AI or a client can never set it.
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

-- Observed conversion-funnel events (Batch 3). Append-only and tenant-scoped;
-- event types are validated in the application before insert.
CREATE TABLE IF NOT EXISTS funnel_events (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  order_id        TEXT REFERENCES orders(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL,
  meta            JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_funnel_events_business ON funnel_events(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_funnel_events_type ON funnel_events(business_id, event_type);

CREATE TABLE IF NOT EXISTS subscriptions (
  business_id                 TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  plan                        TEXT NOT NULL DEFAULT 'Free',
  status                      TEXT NOT NULL DEFAULT 'active',
  paystack_customer_code      TEXT,
  paystack_subscription_code  TEXT,
  paystack_plan_code          TEXT,
  paystack_email_token        TEXT,
  current_period_start        TIMESTAMPTZ,
  current_period_end          TIMESTAMPTZ,
  cancelled_at                TIMESTAMPTZ,
  expires_at                  TIMESTAMPTZ,
  last_reference              TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS paystack_transactions (
  reference   TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  plan        TEXT NOT NULL,
  currency    TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  plan_code   TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  event       TEXT,
  error       TEXT,
  processed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  business_id  TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS crm_connections (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'connected',
  last_sync   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, provider_id)
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. INDEXES

CREATE INDEX IF NOT EXISTS idx_agents_business ON agents(business_id);
CREATE INDEX IF NOT EXISTS idx_touchpoints_business ON touchpoints(business_id);
CREATE INDEX IF NOT EXISTS idx_touchpoints_agent ON touchpoints(agent_id);
CREATE INDEX IF NOT EXISTS idx_scans_touchpoint ON touchpoint_scans(touchpoint_id);
CREATE INDEX IF NOT EXISTS idx_conversations_business ON conversations(business_id);
CREATE INDEX IF NOT EXISTS idx_conversations_touchpoint ON conversations(touchpoint_id);
CREATE INDEX IF NOT EXISTS idx_conversations_stage ON conversations(business_id, stage);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_leads_business ON leads(business_id);
CREATE INDEX IF NOT EXISTS idx_products_business ON products(business_id);
CREATE INDEX IF NOT EXISTS idx_products_business_status ON products(business_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_conversation ON leads(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_notifications_business ON lead_notifications(business_id);

CREATE INDEX IF NOT EXISTS idx_scans_business_created ON touchpoint_scans(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_business_created ON conversations(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_business_created ON leads(business_id, created_at);

CREATE INDEX IF NOT EXISTS idx_orders_business_created ON orders(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_conversation ON orders(conversation_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_commercial_actions_business ON commercial_actions(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_commercial_actions_status ON commercial_actions(business_id, status);
CREATE INDEX IF NOT EXISTS idx_channel_identities_conversation ON channel_identities(conversation_id);
CREATE INDEX IF NOT EXISTS idx_channel_config_business ON channel_config(business_id);

CREATE INDEX IF NOT EXISTS idx_paystack_tx_business ON paystack_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_subscription_code ON subscriptions(paystack_subscription_code);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer_code ON subscriptions(paystack_customer_code);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash);

-- 4. TRIGGER FOR UPDATED_AT (standard PostgreSQL pattern)

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
DECLARE
    t text;
BEGIN
    FOR t IN 
        SELECT table_name 
        FROM information_schema.columns 
        WHERE column_name = 'updated_at' 
        AND table_schema = 'public'
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I', t);
        EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', t);
    END LOOP;
END;
$$;
