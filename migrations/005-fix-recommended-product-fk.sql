-- 005-fix-recommended-product-fk.sql
-- Ensure the recommended-product ownership FK exists specifically on the
-- production public.conversations table.
--
-- Context: migration 003 added this FK, but its guard matched on the
-- constraint name alone across all schemas. On databases that also host the
-- touchpoint_test schema (created from schema-pg.sql), the pre-existing,
-- same-named constraint there satisfied the guard and the production FK was
-- never created. This migration re-applies that FK with a schema-aware guard
-- scoped to public.conversations.
--
-- Backward compatible:
--   - it only ever adds the missing FK; nothing is rewritten, dropped or
--     deleted,
--   - if the FK already exists on public.conversations it is left untouched,
--   - existing conversations keep their rows (the FK references existing
--     products, and ON DELETE SET NULL is unchanged).
--
-- Idempotent (schema-scoped, guarded) so it is safe to re-run.

-- OWNERSHIP ENFORCEMENT AT THE DATABASE LEVEL (public schema): a conversation
-- in public can only ever point at a product in public. Deleting a product
-- simply nulls the reference.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'fk_conversations_recommended_product'
          AND c.conrelid = 'public.conversations'::regclass
          AND c.contype = 'f'
    ) THEN
        ALTER TABLE ONLY public.conversations
        ADD CONSTRAINT fk_conversations_recommended_product
        FOREIGN KEY (recommended_product_id) REFERENCES public.products(id) ON DELETE SET NULL;
    END IF;
END $$;