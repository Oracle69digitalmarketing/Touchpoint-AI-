-- 004-lead-intel-conversion.sql
-- Batch 3 (lead intelligence, qualification and handoff/conversion actions):
--   - remember when a customer has explicitly declined to share contact
--     details, so the agent never asks again (no duplicate/forced capture),
--   - an append-only, business-scoped funnel event log recording only the
--     transitions the application actually observed.
--
-- Backward compatible:
--   - existing conversations keep their history and simply gain the new column
--     with a safe default (FALSE = never declined),
--   - the funnel log is a brand-new table; no existing row is touched.
--
-- Idempotent (IF NOT EXISTS) so it can run safely on databases initialized
-- from schema-pg.sql, which already includes these objects.

-- 1. CONTACT-SHARING DECLINATION (never re-ask after an explicit decline)

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS contact_declined BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. OBSERVED CONVERSION-FUNNEL EVENTS (append-only, tenant-scoped)
--
-- Event types are validated in the application before insert:
--   lead_field_captured, qualification_updated, recommendation_made,
--   objection_detected, buying_signal_detected, handoff_offered,
--   handoff_started, quote_requested, booking_started, demo_requested,
--   purchase_started.
-- Completion events (handoff_completed, conversion_completed, ...) are
-- deliberately NOT recordable: the application cannot confirm an off-platform
-- action and must never claim one.

CREATE TABLE IF NOT EXISTS funnel_events (
    id              TEXT PRIMARY KEY,
    business_id     TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    event_type      TEXT NOT NULL,
    meta            JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_funnel_events_business ON funnel_events(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_funnel_events_type ON funnel_events(business_id, event_type);
