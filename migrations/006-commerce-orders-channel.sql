-- 006-commerce-orders-channel.sql
-- Phase 13A commercial transaction foundation:
--   - deterministic orders + order_items (products stay authoritative for
--     identity, pricing and availability; unit prices are snapshotted),
--   - validated commercial-action proposals (the AI may propose, only the
--     server may execute, and only after deterministic validation),
--   - channel identity (one business+channel+external customer id maps to one
--     conversation) and public channel configuration,
--   - funnel_events gain an optional order_id so commercial moments are
--     recorded with the same Phase 12 model (append-only, tenant-scoped).
--
-- Backward compatible:
--   - conversations.touchpoint_id becomes nullable so a channel-originated
--     conversation does not need a QR touchpoint; every existing row is
--     untouched (dropping NOT NULL never removes data),
--   - conversations gain a `channel` column defaulting to the existing 'web'
--     path, so current behavior is preserved and resumable,
--   - orders/order_items/commercial_actions/channel_identities/channel_config
--     are brand-new tables; no existing row is touched.
--
-- Payment state can only ever change via verified payment-provider events
-- (implemented in a later phase). No Phase 13A code path, and no LLM payload,
-- can set payment_status = paid or status = paid/fulfilled on an order.
--
-- Idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / guarded) so it can run
-- safely on databases initialized from schema-pg.sql, which already includes
-- these objects.

-- 1. CONVERSATIONS: introduce the channel and allow channel-originated
-- conversations without a QR touchpoint.

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web';
ALTER TABLE conversations ALTER COLUMN touchpoint_id DROP NOT NULL;

-- 2. ORDERS

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

CREATE INDEX IF NOT EXISTS idx_orders_business_created ON orders(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_conversation ON orders(conversation_id);

-- 3. ORDER ITEMS (unit price + product name are snapshotted; quantity-total
-- arithmetic is done by the server from the authoritative product price).

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

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);

-- 4. COMMERCIAL ACTIONS (validated proposals; status is server-controlled)

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

CREATE INDEX IF NOT EXISTS idx_commercial_actions_business ON commercial_actions(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_commercial_actions_status ON commercial_actions(business_id, status);

-- 5. CHANNEL IDENTITY + PUBLIC CHANNEL CONFIGURATION

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

CREATE INDEX IF NOT EXISTS idx_channel_identities_conversation ON channel_identities(conversation_id);

CREATE TABLE IF NOT EXISTS channel_config (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL,
  enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  status       TEXT NOT NULL DEFAULT 'not_configured',
  display_name TEXT NOT NULL DEFAULT 'WhatsApp',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_channel_config_business ON channel_config(business_id);

-- 6. FUNNEL EVENTS: optional order linkage (the orders table must exist above)

ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS order_id TEXT REFERENCES orders(id) ON DELETE SET NULL;