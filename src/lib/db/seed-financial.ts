import Database from 'better-sqlite3';
import { resolve } from 'node:path';

const DB_PATH = resolve(process.cwd(), 'data', 'pm.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Update FTL Trace to fixed payment type
db.prepare('UPDATE project_config SET payment_type = ?, start_date = ? WHERE project_id = ?')
  .run('fixed', '2026-01-01', 'ftl-trace');

// Insert fixed payment for FTL Trace
db.prepare(`INSERT OR REPLACE INTO fixed_payments (id, project_id, amount, currency, period, start_date)
  VALUES (?, ?, ?, ?, ?, ?)`)
  .run('fp-ftl-trace-monthly', 'ftl-trace', 2000, 'USD', 'monthly', '2026-01-01');

// SMAC Control (ASAP) — hourly, rate agreed, user enters monthly total
db.prepare('UPDATE project_config SET payment_type = ?, start_date = ? WHERE project_id = ?')
  .run('hourly', '2025-01-01', 'smac-control');
db.prepare('UPDATE project_config SET rate_override = ? WHERE project_id = ?')
  .run(35, 'smac-control');

console.log('FTL config:', db.prepare('SELECT * FROM project_config WHERE project_id = ?').get('ftl-trace'));
console.log('SMAC config:', db.prepare('SELECT * FROM project_config WHERE project_id = ?').get('smac-control'));
console.log('Fixed payments:', db.prepare('SELECT * FROM fixed_payments').all());

db.close();
console.log('Done!');
