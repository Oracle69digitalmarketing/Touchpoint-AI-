-- 009-whatsapp.sql
-- Phase 13D-Batch A: real Meta WhatsApp Cloud API webhook/infrastructure.
--
--   - channel_config gains the Meta phone number id a business's WhatsApp
--     channel is bound to. The unique partial index on phone_number_id makes
--     tenant resolution unambiguous: an inbound webhook carrying a given Meta
--     phone number id always maps to exactly one business (strict isolation;
--     tenant identity is never accepted from webhook body fields).
--   - whatsapp_messages is the message ledger: inbound messages (persisted for
--     idempotency — the unique partial index on wa_message_id turns duplicate
--     Meta deliveries into no-ops) and outbound messages (with normalized
--     provider status: queued -> sent -> delivered -> read, or failed).
--     message_type + a reserved media JSONB column let media land in the ledger
--     safely before the media pipeline exists; unsupported types are stored,
--     never pretended to be handled.
--
-- Backward compatible: additive only. Existing channel_config rows keep
-- NULL phone_number_id, so no existing business is bound to a Meta number until
-- it does so explicitly.
--
-- Idempotent (IF NOT EXISTS / guarded ADD COLUMN / indexes) so it can run
-- safely on databases already initialized from schema-pg.sql.

ALTER TABLE channel_config ADD COLUMN IF NOT EXISTS phone_number_id TEXT;
ALTER TABLE channel_config ADD COLUMN IF NOT EXISTS provider_business_account_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_config_phone_number_id
  ON channel_config(phone_number_id) WHERE phone_number_id IS NOT NULL;

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