import fs from 'fs';
import { pool } from '../db-pg.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function applyMigration() {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/002-password-reset.sql'), 'utf8');
  console.log('Applying migration...');
  await pool.query(sql);
  console.log('Migration applied successfully.');
  process.exit(0);
}

applyMigration().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
