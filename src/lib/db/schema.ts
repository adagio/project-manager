import { pgSchema, text, real, integer, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const pmSchema = pgSchema('project_manager');

// Companies / Clients
export const companies = pmSchema.table('companies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  contact: text('contact'),
  notes: text('notes'),
});

// Global settings (key-value)
export const settings = pmSchema.table('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// Roles
export const roles = pmSchema.table('roles', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  defaultRate: real('default_rate'),
});

// Project financial config (extends projects.json)
export const projectConfig = pmSchema.table('project_config', {
  projectId: text('project_id').primaryKey(),
  companyId: text('company_id').references(() => companies.id),
  rateOverride: real('rate_override'),
  status: text('status').default('active').notNull(), // active | paused | completed | archived
  paymentType: text('payment_type').default('hourly').notNull(), // hourly | fixed | mixed
  startDate: text('start_date'),
  endDate: text('end_date'),
});

// Project-role assignments with rate override
export const projectRoles = pmSchema.table('project_roles', {
  projectId: text('project_id').notNull(),
  roleId: text('role_id').notNull().references(() => roles.id),
  rateOverride: real('rate_override'),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.roleId] }),
]);

// Fixed payments (recurring)
export const fixedPayments = pmSchema.table('fixed_payments', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  amount: real('amount').notNull(),
  currency: text('currency').default('USD').notNull(),
  period: text('period').default('monthly').notNull(), // monthly | biweekly
  startDate: text('start_date').notNull(),
  endDate: text('end_date'),
});

// Time entries
export const timeEntries = pmSchema.table('time_entries', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  date: text('date').notNull(),
  hours: real('hours').notNull(),
  roleId: text('role_id').references(() => roles.id),
  description: text('description'),
  source: text('source').default('manual').notNull(), // manual | activitywatch
  createdAt: text('created_at').default(sql`now()`).notNull(),
});

// Invoices
export const invoices = pmSchema.table('invoices', {
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
export const invoiceItems = pmSchema.table('invoice_items', {
  id: text('id').primaryKey(),
  invoiceId: text('invoice_id').notNull().references(() => invoices.id),
  description: text('description').notNull(),
  hours: real('hours'),
  rate: real('rate'),
  amount: real('amount').notNull(),
});

// Learnings
export const learnings = pmSchema.table('learnings', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  date: text('date').notNull(),
  content: text('content').notNull(),
  tags: text('tags'), // JSON array as string: '["technical","process"]'
  createdAt: text('created_at').default(sql`now()`).notNull(),
});

// Tasks
export const tasks = pmSchema.table('tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').default('backlog').notNull(), // backlog | ready | doing | blocked | done
  dueDate: text('due_date'),
  estimateHours: real('estimate_hours'),
  tags: text('tags'),
  position: integer('position').default(0).notNull(),
  createdAt: text('created_at').default(sql`now()`).notNull(),
  updatedAt: text('updated_at').default(sql`now()`).notNull(),
  completedAt: text('completed_at'),
});
