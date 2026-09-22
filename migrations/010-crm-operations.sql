-- 010-crm-operations.sql
-- Phase 13F CRM persistence:
--   - operator-controlled CRM status on leads, stored separately from the
--     AI-driven qualification state (qualification_status/score) and from the
--     sales conversation stage,
--   - optional lead assignment to a workspace user; tenant ownership is
--     enforced at the application layer (the FK below only guarantees that the
--     assigned user exists),
--   - an append-only, tenant-scoped note stream on leads with an explicit
--     human/ai source distinction (no note is generated in this phase),
--   - an optional lead anchor on funnel_events so a lead's CRM timeline can
--     surface conversation-less / booking-only events, mirroring the lead_id
--     anchoring already applied to orders, commercial_actions and bookings.
--
-- Backward compatible:
--   - leads gain one NOT NULL column with a safe default and one nullable
--     column; every existing (and future) lead backfills crm_status = 'new'
--     and stays readable,
--   - crm_notes is a brand-new table; no existing row is touched,
--   - funnel_events.lead_id is nullable and intentionally NULL for historical
--     events — no lead id is ever fabricated.
--
-- No new funnel event types are introduced. Sales-stage, qualification,
-- payment, order, booking and WhatsApp behaviour is unchanged.
--
-- Idempotent (IF NOT EXISTS / guarded constraints) so it can run safely on
-- databases initialized from schema-pg.sql, which already includes these
-- objects.

-- 1. LEAD CRM STATUS (operator-controlled)

ALTER TABLE leads ADD COLUMN IF NOT EXISTS crm_status TEXT NOT NULL DEFAULT 'new';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_leads_crm_status') THEN
        ALTER TABLE leads
        ADD CONSTRAINT ck_leads_crm_status
        CHECK (crm_status IN (
            'new', 'contacted', 'qualified', 'opportunity',
            'customer', 'unqualified', 'lost', 'do_not_contact'
        ));
    END IF;
END $$;

-- 2. LEAD ASSIGNMENT (optional, tenant ownership enforced at the app layer)

ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_user_id TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_leads_assigned_user') THEN
        ALTER TABLE leads
        ADD CONSTRAINT fk_leads_assigned_user
        FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 3. LEAD CRM NOTES (append-only per-lead streams; human/ai source)
--
-- author_user_id is nullable: human notes carry the authenticated author when
-- applicable, and server/origin notes may have no user author. AI notes may be
-- stored with source = 'ai' but nothing generates them in this phase.

CREATE TABLE IF NOT EXISTS crm_notes (
    id             TEXT PRIMARY KEY,
    business_id    TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    lead_id        TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    body           TEXT NOT NULL,
    source         TEXT NOT NULL CHECK (source IN ('human', 'ai')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. FUNNEL EVENT LEAD ANCHOR (optional; no new event types)

ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS lead_id TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_funnel_events_lead') THEN
        ALTER TABLE funnel_events
        ADD CONSTRAINT fk_funnel_events_lead
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 5. INDEXES

CREATE INDEX IF NOT EXISTS idx_leads_business_status ON leads(business_id, crm_status);
CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(assigned_user_id) WHERE assigned_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_notes_lead ON crm_notes(lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_funnel_events_lead ON funnel_events(lead_id);