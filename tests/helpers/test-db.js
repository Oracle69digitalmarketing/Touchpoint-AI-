/**
 * Shared PostgreSQL test database helper.
 *
 * Each test file imports `setupTestDb()` and `cleanupTestDb()` to get a clean,
 * schema-initialized PostgreSQL database for the duration of the suite. All
 * suites share the same test database and clean up after themselves.
 */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/touchpoint_test';

const SCHEMA_PATH = path.join(__dirname, '..', '..', 'schema-pg.sql');

const TABLES_TO_TRUNCATE = [
  'password_reset_tokens',
  'lead_notifications',
  'leads',
  'conversation_messages',
  'conversations',
  'touchpoint_scans',
  'touchpoints',
  'agents',
  'sessions',
  'users',
  'subscriptions',
  'paystack_transactions',
  'webhook_events',
  'crm_connections',
  'businesses',
];

let schemaApplied = false;

/**
 * Sets DATABASE_URL, applies the schema (once), and returns a pool.
 * Call this at the top of each test file (before importing server.js).
 */
export async function setupTestDb() {
  process.env.DATABASE_URL = TEST_DATABASE_URL;

  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });

  if (!schemaApplied) {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    await pool.query(schema);
    schemaApplied = true;
  }

  return pool;
}

/**
 * Truncates all tables and closes the pool.
 */
export async function cleanupTestDb(pool) {
  if (!pool) return;
  for (const table of TABLES_TO_TRUNCATE) {
    await pool.query(`TRUNCATE ${table} CASCADE`);
  }
  await pool.end();
}
