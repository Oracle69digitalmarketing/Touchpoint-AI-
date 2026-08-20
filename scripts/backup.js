/**
 * PostgreSQL backup via pg_dump
 *
 * Dumps the database referenced by DATABASE_URL to a timestamped SQL file.
 * Uses pg_dump (must be available in PATH) — no Node dependencies needed.
 *
 * Usage: node scripts/backup.js
 *
 * Env:
 *   DATABASE_URL       - the full PostgreSQL connection string
 *   BACKUP_DIR         - where backups are written (defaults to ./backups)
 *   PG_DUMP_PATH       - optional path to pg_dump binary
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Cannot back up.');
  process.exit(1);
}

const backupDir = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(root, 'backups');

const pgDump = process.env.PG_DUMP_PATH || 'pg_dump';

fs.mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destPath = path.join(backupDir, `touchpoint-${stamp}.sql`);

const cmd = `"${pgDump}" "${databaseUrl}" --no-owner --no-privileges --clean --if-exists > "${destPath}"`;

try {
  execSync(cmd, { stdio: 'pipe' });
  fs.chmodSync(destPath, 0o600);
  console.log(`Backup written to ${destPath}`);
} catch (err) {
  console.error('pg_dump failed:', err.stderr?.toString() || err.message);
  try { fs.rmSync(destPath, { force: true }); } catch (_) {}
  process.exit(1);
}

// Retention: keep the newest 14 backups so long-running deployments do not
// accumulate unbounded copies. Only files matching the backup naming pattern
// are removed.
const retained = 14;
const backups = fs
  .readdirSync(backupDir)
  .filter((name) => /^touchpoint-.*\.sql$/.test(name))
  .map((name) => path.join(backupDir, name))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

for (const old of backups.slice(retained)) {
  fs.rmSync(old, { force: true });
}
console.log(`Retaining the newest ${retained} backups in ${backupDir}.`);
