import type { Project } from './types';
import { TTLCache } from './cache';

const AW_BASE = process.env.AW_SERVER_URL || 'http://localhost:5600';
const WINDOW_BUCKET = 'aw-watcher-window_SHIP';

// Cache raw events by month — one fetch serves week/day/month views
// Key: "YYYY-MM", Value: parsed events with projectId+date+duration
interface CachedEntry {
  projectId: string;
  date: string;
  duration: number;
}
const monthCache = new TTLCache<CachedEntry[]>(5 * 60 * 1000); // 5 min
const availableCache = new TTLCache<boolean>(60 * 1000); // 1 min

interface AWEvent {
  timestamp: string;
  duration: number;
  data: Record<string, string>;
}

async function awFetch(path: string): Promise<unknown> {
  const res = await fetch(`${AW_BASE}${path}`);
  if (!res.ok) throw new Error(`AW API error: ${res.status}`);
  return res.json();
}

export async function isAWAvailable(): Promise<boolean> {
  const cached = availableCache.get('available');
  if (cached !== undefined) return cached;

  try {
    await awFetch('/api/0/info');
    availableCache.set('available', true);
    return true;
  } catch {
    availableCache.set('available', false);
    return false;
  }
}

function matchTitle(title: string, projects: Project[]): Project | null {
  for (const project of projects) {
    if (!project.awPatterns || project.awPatterns.length === 0) continue;
    for (const pattern of project.awPatterns) {
      try {
        if (new RegExp(pattern, 'i').test(title)) return project;
      } catch {
        if (title.toLowerCase().includes(pattern.toLowerCase())) return project;
      }
    }
  }
  return null;
}

/**
 * Fetch and cache events for a given month. Returns pre-matched entries.
 */
async function getMonthEntries(year: number, month: number, projects: Project[]): Promise<CachedEntry[]> {
  const key = `${year}-${String(month + 1).padStart(2, '0')}`;
  const cached = monthCache.get(key);
  if (cached) return cached;

  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 1);
  const now = new Date();
  const clampedEnd = end > now ? now : end;

  const entries: CachedEntry[] = [];

  try {
    const events = await awFetch(
      `/api/0/buckets/${WINDOW_BUCKET}/events?start=${start.toISOString()}&end=${clampedEnd.toISOString()}&limit=-1`
    ) as AWEvent[];

    for (const event of events) {
      const title = event.data.title;
      if (!title) continue;
      const matched = matchTitle(title, projects);
      if (!matched) continue;
      entries.push({
        projectId: matched.id,
        date: event.timestamp.split('T')[0],
        duration: event.duration,
      });
    }
  } catch {
    // AW not available
  }

  monthCache.set(key, entries);
  return entries;
}

/**
 * Get all cached entries covering a date range. Fetches needed months.
 */
async function getEntriesForRange(from: Date, to: Date, projects: Project[]): Promise<CachedEntry[]> {
  // Collect all months that overlap with the range
  const months: { year: number; month: number }[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cursor <= to) {
    months.push({ year: cursor.getFullYear(), month: cursor.getMonth() });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const allEntries: CachedEntry[] = [];
  const fromStr = from.toISOString().split('T')[0];
  const toStr = to.toISOString().split('T')[0];

  for (const { year, month } of months) {
    const entries = await getMonthEntries(year, month, projects);
    for (const e of entries) {
      if (e.date >= fromStr && e.date <= toStr) {
        allEntries.push(e);
      }
    }
  }

  return allEntries;
}

/**
 * Get total time by project from window titles.
 */
export async function getTimeByProject(
  projects: Project[],
  from: Date,
  to: Date,
): Promise<Map<string, number>> {
  const entries = await getEntriesForRange(from, to, projects);
  const result = new Map<string, number>();
  for (const e of entries) {
    result.set(e.projectId, (result.get(e.projectId) || 0) + e.duration);
  }
  return result;
}

/**
 * Get daily time by project from window titles for charting.
 */
export async function getDailyTimeByProject(
  projects: Project[],
  from: Date,
  to: Date,
): Promise<Map<string, Map<string, number>>> {
  const entries = await getEntriesForRange(from, to, projects);
  const result = new Map<string, Map<string, number>>();
  for (const e of entries) {
    if (!result.has(e.projectId)) result.set(e.projectId, new Map());
    const dayMap = result.get(e.projectId)!;
    dayMap.set(e.date, (dayMap.get(e.date) || 0) + e.duration);
  }
  return result;
}
