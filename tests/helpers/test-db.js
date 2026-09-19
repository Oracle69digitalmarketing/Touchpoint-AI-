/**
 * Shared PostgreSQL test database helper.
 *
 * Each test file imports `setupTestDb()` and `cleanupTestDb()` to get a clean,
 * schema-initialized PostgreSQL database for the duration of the suite. All
 * suites share the same test database and clean up after themselves.
 *
 * ISOLATION: all test objects live inside the dedicated `touchpoint_test`
 * schema on the configured database. `public` is never created in, modified,
 * truncated, dropped, or queried.
 *
 *   - Every pool created during a test process connects with
 *     `search_path = touchpoint_test` (PGOPTIONS for the pool created inside
 *     db-pg.js via DATABASE_URL, plus an explicit `options` connection
 *     parameter on the helper pool). Unqualified table references therefore
 *     always resolve to `touchpoint_test`.
 *   - schema-pg.sql is applied with `search_path` pinned to `touchpoint_test`
 *     and is rewritten ON THE FLY (the file itself is never modified) so that:
 *       1. the trigger bootstrap that scans `table_schema = 'public'` is
 *          redirected to `touchpoint_test`, and
 *       2. `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";` is skipped — nothing
 *          in the schema uses uuid-ossp functions, so the shared database's
 *          extension configuration is never altered.
 *   - Cleanup TRUNCATE statements explicitly target `touchpoint_test.<table>`.
 */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_SCHEMA = 'touchpoint_test';
const TEST_SEARCH_PATH_OPTION = `-c search_path=${TEST_SCHEMA}`;

const DATABASE_URL_REQUIRED =
  'DATABASE_URL is required to run the tests: supply the hosted isolated "touchpoint_test" database connection; refusing to fall back to a local PostgreSQL instance.';
const { DATABASE_URL } = process.env;
if (!DATABASE_URL) throw new Error(DATABASE_URL_REQUIRED);
const TEST_DATABASE_URL = DATABASE_URL;

const SCHEMA_PATH = path.join(__dirname, '..', '..', 'schema-pg.sql');

const TABLES_TO_TRUNCATE = [
  'password_reset_tokens',
  'lead_notifications',
  'funnel_events',
  'order_items',
  'orders',
  'commercial_actions',
  'channel_identities',
  'channel_config',
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
  'products',
];

let schemaApplied = false;

/**
 * Loads schema-pg.sql and rewrites it in memory so that every object and the
 * trigger bootstrap land inside TEST_SCHEMA instead of `public`. The on-disk
 * file is never modified.
 */
function testSchemaSql() {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');

  const withoutExtension = schema.replace(
    /^\s*CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+"uuid-ossp";\s*$/gim,
    ''
  );

  return withoutExtension.replace(
    /table_schema = 'public'/g,
    `table_schema = '${TEST_SCHEMA}'`
  );
}

/**
 * Sets DATABASE_URL, applies the schema (once) into TEST_SCHEMA, and returns a
 * pool whose search_path targets TEST_SCHEMA.
 * Call this at the top of each test file (before importing server.js).
 */
export async function setupTestDb() {
  process.env.DATABASE_URL = TEST_DATABASE_URL;

  // db-pg.js builds its pool from process.env.DATABASE_URL at import time, so
  // this is the only place a test process can force its search_path without
  // touching application code.
  process.env.PGOPTIONS = TEST_SEARCH_PATH_OPTION;

  const pool = new pg.Pool({
    connectionString: TEST_DATABASE_URL,
    options: TEST_SEARCH_PATH_OPTION,
  });

  if (!schemaApplied) {
    const sql = [
      `DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE;`,
      `CREATE SCHEMA ${TEST_SCHEMA};`,
      `SET search_path = ${TEST_SCHEMA};`,
      testSchemaSql(),
    ].join('\n');

    await pool.query(sql);
    schemaApplied = true;
  }

  return pool;
}

/**
 * Truncates all tables inside TEST_SCHEMA and closes the pool.
 */
export async function cleanupTestDb(pool) {
  if (!pool) return;
  for (const table of TABLES_TO_TRUNCATE) {
    await pool.query(`TRUNCATE ${TEST_SCHEMA}.${table} CASCADE`);
  }
  await pool.end();
}