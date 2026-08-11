/**
 * SQLITE PRODUCTION BACKUP (Phase 8)
 *
 * Creates a consistent, point-in-time copy of the live touchpoint.db while the
 * server keeps running. Uses SQLite's online backup API (better-sqlite3
 * `db.backup`), which is safe with WAL: no downtime, no torn files.
 *
 * Usage: node scripts/backup.js
 *
 * Env:
 *   DATA_DIR    - where the source touchpoint.db lives (defaults to ./data)
 *   BACKUP_DIR  - where backups are written (defaults to ./data/backups)
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(root, 'data');
const backupDir = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(dataDir, 'backups');

const sourcePath = path.join(dataDir, 'touchpoint.db');

if (!fs.existsSync(sourcePath)) {
  console.error(`No database found at ${sourcePath}. Nothing to back up.`);
  process.exit(1);
}

fs.mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destPath = path.join(backupDir, `touchpoint-${stamp}.db`);

// Open read-only so the backup never contends with the running server for the
// write lock. backup() is async (page-by-page transfers on the event loop),
// so the source connection must stay open until it resolves.
const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
try {
  await source.backup(destPath);
} finally {
  source.close();
}

try {
  fs.chmodSync(destPath, 0o600);
} catch (err) {
  // chmod is POSIX-only; a failed chmod is not fatal to the backup itself.
}

console.log(`Backup written to ${destPath}`);

// Retention: keep the newest 14 backups so long-running deployments do not
// accumulate unbounded copies. Only files matching the backup naming pattern
// are removed.
const retained = 14;
const backups = fs
  .readdirSync(backupDir)
  .filter((name) => /^touchpoint-.*\.db$/.test(name))
  .map((name) => path.join(backupDir, name))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

for (const old of backups.slice(retained)) {
  fs.rmSync(old, { force: true });
}
console.log(`Retaining the newest ${retained} backups in ${backupDir}.`);
