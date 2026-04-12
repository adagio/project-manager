import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import * as schema from './schema';

const DB_PATH = resolve(process.cwd(), 'data', 'pm.db');
const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Read projects.json
const projectsJson = JSON.parse(
  readFileSync(resolve(process.cwd(), 'projects.json'), 'utf-8')
);

// Seed companies (extract unique from projects)
const companyMap: Record<string, string> = {
  'FTL-Hub': 'ftl-hub',
  'ASAP': 'asap',
  'PalPoints': 'palpoints',
};

console.log('Seeding companies...');
for (const [name, id] of Object.entries(companyMap)) {
  db.insert(schema.companies)
    .values({ id, name })
    .onConflictDoNothing()
    .run();
}

// Seed roles
console.log('Seeding roles...');
const rolesData = [
  { id: 'fullstack-dev', label: 'Fullstack Developer', defaultRate: 35 },
  { id: 'tech-lead', label: 'Tech Lead / Arquitecto', defaultRate: 45 },
  { id: 'ai-engineer', label: 'AI/Automation Engineer', defaultRate: 40 },
  { id: 'product-owner', label: 'Product Owner / Founder', defaultRate: null },
];
for (const role of rolesData) {
  db.insert(schema.roles)
    .values(role)
    .onConflictDoNothing()
    .run();
}

// Seed settings
console.log('Seeding settings...');
const settingsData = [
  { key: 'defaultHourlyRate', value: '35' },
  { key: 'currency', value: 'USD' },
];
for (const s of settingsData) {
  db.insert(schema.settings)
    .values(s)
    .onConflictDoNothing()
    .run();
}

// Seed project_config from projects.json
console.log('Seeding project configs...');
for (const project of projectsJson.projects) {
  const companyId = project.company ? companyMap[project.company] || null : null;
  db.insert(schema.projectConfig)
    .values({
      projectId: project.id,
      companyId,
      status: 'active',
      paymentType: 'hourly',
    })
    .onConflictDoNothing()
    .run();
}

console.log('Seed complete!');
sqlite.close();
