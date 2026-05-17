import { db } from '../db/index';
import { learnings } from '../db/schema';
import { eq, desc } from 'drizzle-orm';

export async function getLearnings(projectId?: string) {
  if (projectId) {
    return await db.select().from(learnings)
      .where(eq(learnings.projectId, projectId))
      .orderBy(desc(learnings.date));
  }
  return await db.select().from(learnings).orderBy(desc(learnings.date));
}

export async function addLearning(entry: {
  projectId: string;
  date: string;
  content: string;
  tags?: string[];
}) {
  const id = `learn-${Date.now()}`;
  await db.insert(learnings).values({
    id,
    projectId: entry.projectId,
    date: entry.date,
    content: entry.content,
    tags: entry.tags ? JSON.stringify(entry.tags) : null,
  });
  return id;
}

export async function deleteLearning(id: string) {
  await db.delete(learnings).where(eq(learnings.id, id));
}

export function parseTags(tagsStr: string | null): string[] {
  if (!tagsStr) return [];
  try { return JSON.parse(tagsStr); } catch { return []; }
}
