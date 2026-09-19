-- 007-payment-intents.sql
-- Phase 13B payment architecture: provider-neutral payment intents.
--
--   - payment_intents is the settlement ledger: at most ONE live 'pending'
--     intent per order (partial unique index), one provider reference per
--     intent (unique), all amounts in exact integer minor units, and a
--     provider_event_id recorded at settlement time for reconciliation.
--   - Settlement (intent 'succeeded' + order status/paid) happens ONLY in the
--     atomic compare-and-set transaction (settleOrderPayment in db-pg), which
--     is reached exclusively from verified provider webhook events. No AI,
--     client, or callback path can invoke it.
--   - Failed/expired intents are terminal for the intent but never cancel the
--     order; the order stays 'pending_payment' and retryable.
--
-- Backward compatible: additive only; every existing row and table is
-- untouched. The table ships empty (zero rows) in production.
--
-- Idempotent (IF NOT EXISTS / guarded unique index) so it can run safely on
-- databases already initialized from schema-pg.sql, which includes the same
-- objects.

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