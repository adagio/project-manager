import { db } from '../db/index';
import { timeEntries } from '../db/schema';
import { eq, and, gte, lte, desc } from 'drizzle-orm';

export async function getTimeEntries(projectId?: string, from?: string, to?: string) {
  if (projectId && from && to) {
    return await db.select().from(timeEntries).where(
      and(
        eq(timeEntries.projectId, projectId),
        gte(timeEntries.date, from),
        lte(timeEntries.date, to),
      )
    ).orderBy(desc(timeEntries.date));
  }

  if (projectId) {
    return await db.select().from(timeEntries)
      .where(eq(timeEntries.projectId, projectId))
      .orderBy(desc(timeEntries.date));
  }

  if (from && to) {
    return await db.select().from(timeEntries).where(
      and(gte(timeEntries.date, from), lte(timeEntries.date, to))
    ).orderBy(desc(timeEntries.date));
  }

  return await db.select().from(timeEntries).orderBy(desc(timeEntries.date));
}

export async function addTimeEntry(entry: {
  projectId: string;
  date: string;
  hours: number;
  roleId?: string;
  description?: string;
  source?: string;
}) {
  const id = `te-${Date.now()}`;
  await db.insert(timeEntries).values({
    id,
    projectId: entry.projectId,
    date: entry.date,
    hours: entry.hours,
    roleId: entry.roleId ?? null,
    description: entry.description ?? null,
    source: entry.source ?? 'manual',
  });
  return id;
}

export async function deleteTimeEntry(id: string) {
  await db.delete(timeEntries).where(eq(timeEntries.id, id));
}

export async function getProjectTotalHours(projectId: string, from?: string, to?: string): Promise<number> {
  const entries = await getTimeEntries(projectId, from, to);
  return entries.reduce((sum, e) => sum + e.hours, 0);
}
