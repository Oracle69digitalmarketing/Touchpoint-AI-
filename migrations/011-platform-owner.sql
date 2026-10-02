-- 011-platform-owner.sql
-- Platform-owner identity (Phases 1-3):
--   - adds users.is_platform_owner BOOLEAN NOT NULL DEFAULT FALSE,
--   - orthogonal to users.role ('owner' keeps meaning business/workspace
--     ownership; is_platform_owner means platform-level authority),
--   - additive and safe: existing rows backfill FALSE, no existing row is
--     modified beyond the new column default, no new role values introduced.
--
-- Bootstrap: no API may set this field. Designate the builder/operator with a
-- one-time administrative UPDATE (see final report), never via application
-- logic or a hardcoded email.
--
-- Idempotent (IF NOT EXISTS) so it can run safely on databases initialized
-- from schema-pg.sql, which already includes this column.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_owner BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_platform_owner ON users(is_platform_owner) WHERE is_platform_owner = TRUE;
