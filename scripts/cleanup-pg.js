/**
 * PostgreSQL cleanup — truncate all data tables.
 *
 * Drops and recreates every business-owned table (the schema-pg.sql file
 * contains all CREATE TABLE IF NOT EXISTS statements, so this is safe).
 * Useful for wiping a development or test database.
 *
 * Usage: node scripts/cleanup-pg.js
 *
 * Env:
 *   DATABASE_URL - the full PostgreSQL connection string
 *   DANGEROUS=1  - required to confirm the destructive operation
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db-pg.js';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Refusing to run without a target.');
  process.exit(1);
}

if (process.env.DANGEROUS !== '1') {
  console.error('Set DANGEROUS=1 to confirm truncation of all data tables.');
  process.exit(1);
}

const TRUNCATE_SQL = `
  TRUNCATE TABLE
    webhook_events,
    paystack_transactions,
    subscriptions,
    lead_notifications,
    leads,
    conversation_messages,
    conversations,
    touchpoint_scans,
    touchpoints,
    agents,
    crm_connections,
    password_reset_tokens,
    sessions,
    users,
    businesses
  RESTART IDENTITY CASCADE;
`;

async function cleanup() {
  console.log('Truncating all data tables...');
  await pool.query(TRUNCATE_SQL);
  console.log('All tables truncated.');
}

cleanup()
  .then(() => { process.exit(0); })
  .catch((err) => { console.error('Cleanup failed:', err.message); process.exit(1); })
  .finally(() => { pool.end(); });
