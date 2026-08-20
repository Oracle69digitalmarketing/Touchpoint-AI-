-- 001-email-verification.sql
-- Adds email verification to users.
-- Idempotent (IF NOT EXISTS) so it can run safely on databases whose schema
-- was initialized from schema-pg.sql, which already includes these columns.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMPTZ;
