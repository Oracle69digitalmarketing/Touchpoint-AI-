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
  touchpoint_id   TEXT NOT NULL REFERENCES touchpoints(id) ON DELETE CASCADE,
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  customer_name   TEXT,
  target_language TEXT NOT NULL DEFAULT 'en',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_leads_business ON leads(business_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_conversation ON leads(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_notifications_business ON lead_notifications(business_id);

CREATE INDEX IF NOT EXISTS idx_scans_business_created ON touchpoint_scans(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_business_created ON conversations(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_business_created ON leads(business_id, created_at);

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
