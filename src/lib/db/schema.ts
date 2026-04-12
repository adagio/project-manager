import { sqliteTable, text, real, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Companies / Clients
export const companies = sqliteTable('companies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  contact: text('contact'),
  notes: text('notes'),
});

// Global settings (key-value)
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// Roles
export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  defaultRate: real('default_rate'),
});

// Project financial config (extends projects.json)
export const projectConfig = sqliteTable('project_config', {
  projectId: text('project_id').primaryKey(),
  companyId: text('company_id').references(() => companies.id),
  rateOverride: real('rate_override'),
  status: text('status').default('active').notNull(), // active | paused | completed | archived
  paymentType: text('payment_type').default('hourly').notNull(), // hourly | fixed | mixed
  startDate: text('start_date'),
  endDate: text('end_date'),
});

// Project-role assignments with rate override
export const projectRoles = sqliteTable('project_roles', {
  projectId: text('project_id').notNull(),
  roleId: text('role_id').notNull().references(() => roles.id),
  rateOverride: real('rate_override'),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.roleId] }),
]);

// Fixed payments (recurring)
export const fixedPayments = sqliteTable('fixed_payments', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  amount: real('amount').notNull(),
  currency: text('currency').default('USD').notNull(),
  period: text('period').default('monthly').notNull(), // monthly | biweekly
  startDate: text('start_date').notNull(),
  endDate: text('end_date'),
});

// Time entries
export const timeEntries = sqliteTable('time_entries', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  date: text('date').notNull(),
  hours: real('hours').notNull(),
  roleId: text('role_id').references(() => roles.id),
  description: text('description'),
  source: text('source').default('manual').notNull(), // manual | activitywatch
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Invoices
export const invoices = sqliteTable('invoices', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  number: text('number'),
  type: text('type').default('hourly').notNull(), // hourly | fixed | mixed
  date: text('date').notNull(),
  dueDate: text('due_date'),
  amount: real('amount').notNull(),
  currency: text('currency').default('USD').notNull(),
  status: text('status').default('draft').notNull(), // draft | sent | paid | overdue
  paidDate: text('paid_date'),
  notes: text('notes'),
});

// Invoice line items
export const invoiceItems = sqliteTable('invoice_items', {
  id: text('id').primaryKey(),
  invoiceId: text('invoice_id').notNull().references(() => invoices.id),
  description: text('description').notNull(),
  hours: real('hours'),
  rate: real('rate'),
  amount: real('amount').notNull(),
});

// Learnings
export const learnings = sqliteTable('learnings', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  date: text('date').notNull(),
  content: text('content').notNull(),
  tags: text('tags'), // JSON array as string: '["technical","process"]'
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});
