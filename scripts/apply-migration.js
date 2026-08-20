/**
 * Apply database migrations in order.
 *
 * Migrations are SQL files in migrations/ named NNN-description.sql. Each file
 * is run once and its name recorded in a `_schema_migrations` table so it is
 * never applied twice.
 *
 * Usage: node scripts/apply-migration.js
 *
 * Env:
 *   DATABASE_URL - the full PostgreSQL connection string
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db-pg.js';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      id         SERIAL PRIMARY KEY,
      filename   TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function appliedMigrations() {
  const res = await pool.query('SELECT filename FROM _schema_migrations ORDER BY id');
  return new Set(res.rows.map((r) => r.filename));
}

async function applyMigration() {
  await ensureMigrationsTable();
  const applied = await appliedMigrations();

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log('No pending migrations.');
    return;
  }

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`Applying migration: ${file} ...`);
    await pool.query(sql);
    await pool.query('INSERT INTO _schema_migrations (filename) VALUES ($1)', [file]);
    console.log(`Applied: ${file}`);
  }

  console.log(`Done — applied ${pending.length} migration(s).`);
}

applyMigration()
  .then(() => { process.exit(0); })
  .catch((err) => { console.error('Migration failed:', err.message); process.exit(1); })
  .finally(() => { pool.end(); });
