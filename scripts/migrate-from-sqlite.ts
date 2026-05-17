/**
 * One-shot migration: read every row from data/pm.db (SQLite) and insert
 * into Postgres `project_manager.*` via Drizzle. Idempotent at the row
 * level via ON CONFLICT DO NOTHING; safe to re-run.
 *
 * Run once:
 *   cd PoC && npx tsx scripts/migrate-from-sqlite.ts
 */
import 'dotenv/config';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../src/lib/db/schema';

const SQLITE_PATH = resolve(process.cwd(), 'data', 'pm.db');

const sqlite = new Database(SQLITE_PATH, { readonly: true });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const pg_db = drizzle(pool, { schema });

type SqliteRow = Record<string, unknown>;

function readAll(table: string): SqliteRow[] {
  return sqlite.prepare(`SELECT * FROM ${table}`).all() as SqliteRow[];
}

// Map sqlite column names (snake_case) to drizzle TS field names (camelCase).
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function transform(row: SqliteRow): SqliteRow {
  const out: SqliteRow = {};
  for (const [k, v] of Object.entries(row)) out[snakeToCamel(k)] = v;
  return out;
}

async function migrateTable<T extends keyof typeof schema>(
  sqliteName: string,
  pgTable: (typeof schema)[T],
) {
  const rows = readAll(sqliteName).map(transform);
  if (rows.length === 0) {
    console.log(`  ${sqliteName.padEnd(20)} 0 rows (skipped)`);
    return;
  }
  // Drizzle's onConflictDoNothing requires a target; without it the insert
  // will throw on duplicate PK. We use raw insert and chunk by 500 rows.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    // @ts-expect-error - dynamic insert across union of tables
    await pg_db.insert(pgTable).values(chunk).onConflictDoNothing();
  }
  console.log(`  ${sqliteName.padEnd(20)} ${rows.length} rows migrated`);
}

async function main() {
  console.log('Migrating data from SQLite -> Postgres project_manager schema');
  console.log(`  source: ${SQLITE_PATH}`);
  console.log(`  target: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@')}`);
  console.log('');

  // Insert order respects FKs:
  await migrateTable('companies',      schema.companies);
  await migrateTable('settings',       schema.settings);
  await migrateTable('roles',          schema.roles);
  await migrateTable('project_config', schema.projectConfig);
  await migrateTable('project_roles',  schema.projectRoles);
  await migrateTable('fixed_payments', schema.fixedPayments);
  await migrateTable('time_entries',   schema.timeEntries);
  await migrateTable('invoices',       schema.invoices);
  await migrateTable('invoice_items',  schema.invoiceItems);
  await migrateTable('learnings',      schema.learnings);

  console.log('');
  console.log('Migration complete.');

  sqlite.close();
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  sqlite.close();
  pool.end();
  process.exit(1);
});
