-- 016-email-schema-compatibility.sql
-- Email schema compatibility migration (Phase 15G.2.3)
-- 
-- Root cause: migration 012 created email_messages with columns 'metadata'
-- and 'sent_at', but db-pg.js expects 'payload' and 'send_at'. Additionally,
-- 'sender' and 'subject' are NOT NULL in 012 but db-pg.code expects NULLability.
--
-- This migration adds the missing columns while preserving existing 'metadata'
-- and 'sent_at' columns. Both pairs coexist with the same logical purpose
-- but different names. Application code should use the column names matching
-- its version; neither set is dropped or renamed.
--
-- Idempotency: uses ADD COLUMN IF NOT EXISTS and ALTER COLUMN ... DROP NOT NULL
-- so the migration is safe against re-execution where the migration system
-- supports idempotency.
--
-- Column additions:
--   kind TEXT NOT NULL DEFAULT 'outbox'       — completely missing, required by db-pg.js recordEmailMessage()
--   payload JSONB NOT NULL DEFAULT '{}'       — alongside existing 'metadata', same logical purpose
--   send_at TIMESTAMPTZ                       — alongside existing 'sent_at', same logical purpose
--   sender relaxation: NOT NULL → NULL        — safe constraint relaxation
--   subject relaxation: NOT NULL → NULL       — safe constraint relaxation

-- Add kind column (required by db-pg.js recordEmailMessage())
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'outbox';

-- Add payload column (alongside existing metadata; same logical purpose, different name)
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}';

-- Add send_at column (alongside existing sent_at; same logical purpose, different name)
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS send_at TIMESTAMPTZ;

-- Relax sender from NOT NULL to NULL (safe constraint relaxation)
ALTER TABLE email_messages ALTER COLUMN sender DROP NOT NULL;

-- Relax subject from NOT NULL to NULL (safe constraint relaxation)
ALTER TABLE email_messages ALTER COLUMN subject DROP NOT NULL;