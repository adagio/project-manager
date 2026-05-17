import { db } from '../db/index';
import { tasks } from '../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

export type TaskStatus = 'backlog' | 'ready' | 'doing' | 'blocked' | 'done';

export const TASK_STATUSES: TaskStatus[] = ['backlog', 'ready', 'doing', 'blocked', 'done'];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  ready: 'Listo para implementar',
  doing: 'En proceso',
  blocked: 'Bloqueado',
  done: 'Hecho',
};

export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  backlog: 'var(--color-text-muted)',
  ready: 'var(--color-accent)',
  doing: 'var(--color-warning)',
  blocked: 'var(--color-danger)',
  done: 'var(--color-success)',
};

export type Task = typeof tasks.$inferSelect;

export interface TaskFilter {
  projectId?: string;
  status?: TaskStatus;
  tag?: string;
}

export interface TaskInput {
  projectId: string;
  title: string;
  description?: string | null;
  status?: TaskStatus;
  dueDate?: string | null;
  estimateHours?: number | null;
  tags?: string[];
}

export async function listTasks(filter: TaskFilter = {}): Promise<Task[]> {
  const conditions = [];
  if (filter.projectId) conditions.push(eq(tasks.projectId, filter.projectId));
  if (filter.status) conditions.push(eq(tasks.status, filter.status));

  const where = conditions.length === 1 ? conditions[0]
    : conditions.length > 1 ? and(...conditions)
    : undefined;

  const rows = where
    ? await db.select().from(tasks).where(where).orderBy(tasks.position, desc(tasks.createdAt))
    : await db.select().from(tasks).orderBy(tasks.position, desc(tasks.createdAt));

  if (filter.tag) {
    const needle = filter.tag.toLowerCase();
    return rows.filter(r => parseTags(r.tags).some(t => t.toLowerCase() === needle));
  }
  return rows;
}

export async function getTask(id: string): Promise<Task | null> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return row ?? null;
}

export async function createTask(input: TaskInput): Promise<string> {
  const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await db.insert(tasks).values({
    id,
    projectId: input.projectId,
    title: input.title,
    description: input.description ?? null,
    status: input.status ?? 'backlog',
    dueDate: input.dueDate ?? null,
    estimateHours: clampEstimate(input.estimateHours ?? null),
    tags: input.tags && input.tags.length > 0 ? JSON.stringify(input.tags) : null,
  });
  return id;
}

export async function updateTask(id: string, patch: Partial<TaskInput>): Promise<void> {
  const updates: Partial<typeof tasks.$inferInsert> = {
    updatedAt: sql`now()` as unknown as string,
  };
  if (patch.projectId !== undefined) updates.projectId = patch.projectId;
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.status !== undefined) {
    updates.status = patch.status;
    if (patch.status === 'done') {
      updates.completedAt = sql`now()` as unknown as string;
    } else {
      updates.completedAt = null;
    }
  }
  if (patch.dueDate !== undefined) updates.dueDate = patch.dueDate;
  if (patch.estimateHours !== undefined) updates.estimateHours = clampEstimate(patch.estimateHours);
  if (patch.tags !== undefined) {
    updates.tags = patch.tags && patch.tags.length > 0 ? JSON.stringify(patch.tags) : null;
  }

  await db.update(tasks).set(updates).where(eq(tasks.id, id));
}

export async function changeTaskStatus(id: string, status: TaskStatus): Promise<void> {
  const updates: Partial<typeof tasks.$inferInsert> = {
    status,
    updatedAt: sql`now()` as unknown as string,
    completedAt: status === 'done' ? (sql`now()` as unknown as string) : null,
  };
  await db.update(tasks).set(updates).where(eq(tasks.id, id));
}

export async function deleteTask(id: string): Promise<void> {
  await db.delete(tasks).where(eq(tasks.id, id));
}

export function parseTags(tagsJson: string | null): string[] {
  if (!tagsJson) return [];
  try {
    const parsed = JSON.parse(tagsJson);
    return Array.isArray(parsed) ? parsed.filter(t => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export function parseTagsInput(raw: string): string[] {
  return raw.split(',').map(t => t.trim()).filter(t => t.length > 0);
}

export function formatEstimate(hours: number | null | undefined): string {
  if (hours == null) return '';
  return `${Number.isInteger(hours) ? hours : hours.toFixed(2).replace(/\.?0+$/, '')}h`;
}

export function parseEstimateInput(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = parseFloat(trimmed);
  if (!Number.isFinite(n)) return null;
  return clampEstimate(n);
}

function clampEstimate(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const rounded = Math.round(n * 100) / 100;
  if (rounded < 0) return 0;
  if (rounded > 99.99) return 99.99;
  return rounded;
}

export function nextStatus(current: TaskStatus): TaskStatus | null {
  const i = TASK_STATUSES.indexOf(current);
  return i === -1 || i === TASK_STATUSES.length - 1 ? null : TASK_STATUSES[i + 1];
}

export function prevStatus(current: TaskStatus): TaskStatus | null {
  const i = TASK_STATUSES.indexOf(current);
  return i <= 0 ? null : TASK_STATUSES[i - 1];
}

export function isOverdue(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false;
  const today = new Date().toISOString().split('T')[0];
  return dueDate < today;
}
