import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { HistoryEntry } from './types';
import { TTLCache } from './cache';

const HISTORY_DIR = join(homedir(), '.ps_history');

// Cache parsed history for 60s — invalidated by mtime check
const historyCache = new TTLCache<{ mtime: number; lines: string[] }>(60 * 1000);

function getHistoryPath(slug: string): string {
  return join(HISTORY_DIR, `${slug}.txt`);
}

function getHistoryLines(slug: string): string[] {
  const filePath = getHistoryPath(slug);
  if (!existsSync(filePath)) return [];

  const mtime = statSync(filePath).mtimeMs;
  const cached = historyCache.get(slug);
  if (cached && cached.mtime === mtime) return cached.lines;

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    historyCache.set(slug, { mtime, lines });
    return lines;
  } catch {
    return [];
  }
}

export function hasHistory(slug: string): boolean {
  return existsSync(getHistoryPath(slug));
}

export function getRecentCommands(slug: string, limit = 20): HistoryEntry[] {
  const lines = getHistoryLines(slug);
  const total = lines.length;
  const start = Math.max(0, total - limit);

  return lines.slice(start).map((command, i) => ({
    command: command.trim(),
    lineNumber: start + i + 1,
  })).reverse();
}

export function getCommandCount(slug: string): number {
  return getHistoryLines(slug).length;
}

export function getHistoryLastModified(slug: string): Date | null {
  const filePath = getHistoryPath(slug);
  if (!existsSync(filePath)) return null;

  try {
    return statSync(filePath).mtime;
  } catch {
    return null;
  }
}
