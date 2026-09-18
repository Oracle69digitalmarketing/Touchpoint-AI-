-- 003-sales-catalog-state.sql
-- Batch 2: authoritative structured product catalog, per-business handoff
-- settings, and persistent sales conversation state.
--
-- Backward compatible:
--   - the legacy free-text agents.service_catalog column is left untouched and
--     remains the fallback until structured products are configured,
--   - existing conversations keep their message history and simply gain the new
--     state columns with safe defaults,
--   - deleting a recommended product only nulls the reference (ON DELETE SET
--     NULL), so no conversation is ever dropped.
--
-- Idempotent (IF NOT EXISTS / guarded constraints) so it can run safely on
-- databases initialized from schema-pg.sql, which already includes these
-- objects.

-- 1. PRODUCT/SERVICE CATALOG (authoritative when rows exist)

CREATE TABLE IF NOT EXISTS products (
    id          TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    category    TEXT,
    price       NUMERIC(14, 2) NOT NULL DEFAULT 0,
    currency    TEXT NOT NULL DEFAULT 'NGN',
    status      TEXT NOT NULL DEFAULT 'active',
    metadata    JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_business ON products(business_id);
CREATE INDEX IF NOT EXISTS idx_products_business_status ON products(business_id, status);

-- 2. BUSINESS HANDOFF SETTINGS (only channels that are configured may be offered)

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS whatsapp TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS booking_url TEXT;

-- 3. PERSISTENT SALES CONVERSATION STATE

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'engage';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS intent TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_need TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS recommended_product_id TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS buying_signal BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS objection TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS questions_asked JSONB NOT NULL DEFAULT '[]';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS captured_lead_fields JSONB NOT NULL DEFAULT '{}';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS next_best_action TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_stage ON conversations(business_id, stage);

-- 4. OWNERSHIP ENFORCEMENT AT THE DATABASE LEVEL: a conversation can only ever
-- point at a product that exists (product ids are globally unique, and each
-- product belongs to exactly one business). Deleting a product simply nulls
-- the reference.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_conversations_recommended_product') THEN
        ALTER TABLE conversations
        ADD CONSTRAINT fk_conversations_recommended_product
        FOREIGN KEY (recommended_product_id) REFERENCES products(id) ON DELETE SET NULL;
    END IF;
END $$;