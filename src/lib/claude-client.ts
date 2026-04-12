import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type {
  Project, ClaudePrompt, ClaudeSessionSummary, ClaudeSessionDetail,
  ClaudeTokenUsage, ClaudeProjectSummary, ClaudeDailyActivity, ClaudeGlobalSummary,
} from './types';
import { TTLCache } from './cache';

const CLAUDE_DIR = join(homedir(), '.claude');
const HISTORY_PATH = join(CLAUDE_DIR, 'history.jsonl');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');

// Cache for parsed history.jsonl (mtime-validated, 60s TTL)
const historyCache = new TTLCache<{ mtime: number; prompts: ClaudePrompt[] }>(60_000);

// Cache for per-session token data (5min TTL)
const sessionTokenCache = new TTLCache<ClaudeSessionDetail>(5 * 60_000);

// Cache for project dir listing (30s TTL)
const projectDirsCache = new TTLCache<string[]>(30_000);

// ---- Path matching ----

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

function matchProject(historyPath: string, projects: Project[]): Project | null {
  const normalized = normalizePath(historyPath);
  // Sort by path length descending so more specific paths match first
  const sorted = [...projects].sort((a, b) => b.path.length - a.path.length);

  for (const project of sorted) {
    const projectPath = normalizePath(project.path);
    if (normalized === projectPath) return project;
    // Match subdirectories and worktree siblings (e.g. ftl-trace-tx-develop-4 starts with ftl-trace-tx)
    if (normalized.startsWith(projectPath + '/') || normalized.startsWith(projectPath + '-')) {
      return project;
    }
  }
  return null;
}

function encodePathForClaude(projectPath: string): string {
  return projectPath
    .replace(/:/g, '-')
    .replace(/[\\\/]/g, '-')
    .replace(/\s/g, '-')
    .replace(/_/g, '-')
    .toLowerCase();
}

function getClaudeProjectDirs(project: Project): string[] {
  const cached = projectDirsCache.get(project.id);
  if (cached) return cached;

  if (!existsSync(PROJECTS_DIR)) return [];

  const encoded = encodePathForClaude(project.path);
  const allDirs = readdirSync(PROJECTS_DIR);
  const matched = allDirs.filter(dir => {
    const lower = dir.toLowerCase();
    return lower === encoded || lower.startsWith(encoded + '-') || lower.startsWith(encoded + '/');
  });

  projectDirsCache.set(project.id, matched);
  return matched;
}

// ---- History.jsonl parsing ----

function loadHistory(): ClaudePrompt[] {
  if (!existsSync(HISTORY_PATH)) return [];

  const mtime = statSync(HISTORY_PATH).mtimeMs;
  const cached = historyCache.get('history');
  if (cached && cached.mtime === mtime) return cached.prompts;

  try {
    const content = readFileSync(HISTORY_PATH, 'utf-8');
    const prompts: ClaudePrompt[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        prompts.push({
          display: entry.display || '',
          timestamp: entry.timestamp,
          project: entry.project || '',
          sessionId: entry.sessionId || '',
        });
      } catch { /* skip malformed lines */ }
    }
    historyCache.set('history', { mtime, prompts });
    return prompts;
  } catch {
    return [];
  }
}

function getProjectPrompts(project: Project): ClaudePrompt[] {
  const allPrompts = loadHistory();
  return allPrompts.filter(p => matchProject(p.project, [project]) !== null);
}

// ---- Session JSONL parsing ----

function parseSessionFile(filePath: string): { tokens: ClaudeTokenUsage; models: Record<string, number> } {
  const tokens: ClaudeTokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  const models: Record<string, number> = {};
  const seenUuids = new Set<string>();

  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      if (!line.includes('"type":"assistant"') && !line.includes('"type": "assistant"')) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type !== 'assistant') continue;
        if (entry.uuid && seenUuids.has(entry.uuid)) continue;
        if (entry.uuid) seenUuids.add(entry.uuid);

        const msg = entry.message;
        if (msg?.usage) {
          tokens.inputTokens += msg.usage.input_tokens || 0;
          tokens.outputTokens += msg.usage.output_tokens || 0;
          tokens.cacheReadTokens += msg.usage.cache_read_input_tokens || 0;
          tokens.cacheCreationTokens += msg.usage.cache_creation_input_tokens || 0;
        }
        if (msg?.model) {
          models[msg.model] = (models[msg.model] || 0) + 1;
        }
      } catch { /* skip malformed lines */ }
    }
  } catch { /* file read error */ }

  return { tokens, models };
}

// ---- Per-project functions (fast, history.jsonl only) ----

export function hasClaudeActivity(project: Project): boolean {
  return getProjectPrompts(project).length > 0;
}

export function getRecentPrompts(project: Project, limit = 20): ClaudePrompt[] {
  const prompts = getProjectPrompts(project);
  return prompts.slice(-limit).reverse();
}

export function getClaudePromptCount(project: Project): number {
  return getProjectPrompts(project).length;
}

export function getClaudeSessions(project: Project): ClaudeSessionSummary[] {
  const prompts = getProjectPrompts(project);
  const sessionMap = new Map<string, { promptCount: number; firstPrompt: number; lastPrompt: number }>();

  for (const p of prompts) {
    const existing = sessionMap.get(p.sessionId);
    if (existing) {
      existing.promptCount++;
      existing.firstPrompt = Math.min(existing.firstPrompt, p.timestamp);
      existing.lastPrompt = Math.max(existing.lastPrompt, p.timestamp);
    } else {
      sessionMap.set(p.sessionId, { promptCount: 1, firstPrompt: p.timestamp, lastPrompt: p.timestamp });
    }
  }

  return [...sessionMap.entries()]
    .map(([sessionId, data]) => ({ sessionId, ...data }))
    .sort((a, b) => b.lastPrompt - a.lastPrompt);
}

// ---- Per-project functions (expensive, reads session JSONL files) ----

export function getClaudeSessionDetails(project: Project): ClaudeSessionDetail[] {
  const sessions = getClaudeSessions(project);
  const dirs = getClaudeProjectDirs(project);

  return sessions.map(session => {
    const cacheKey = `${project.id}:${session.sessionId}`;
    const cached = sessionTokenCache.get(cacheKey);
    if (cached) return cached;

    let tokens: ClaudeTokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
    let models: Record<string, number> = {};

    for (const dir of dirs) {
      const sessionFile = join(PROJECTS_DIR, dir, `${session.sessionId}.jsonl`);
      if (existsSync(sessionFile)) {
        const result = parseSessionFile(sessionFile);
        tokens = {
          inputTokens: tokens.inputTokens + result.tokens.inputTokens,
          outputTokens: tokens.outputTokens + result.tokens.outputTokens,
          cacheReadTokens: tokens.cacheReadTokens + result.tokens.cacheReadTokens,
          cacheCreationTokens: tokens.cacheCreationTokens + result.tokens.cacheCreationTokens,
        };
        for (const [model, count] of Object.entries(result.models)) {
          models[model] = (models[model] || 0) + count;
        }
        break; // session file found, no need to check other dirs
      }
    }

    const detail: ClaudeSessionDetail = { ...session, tokens, models };
    sessionTokenCache.set(cacheKey, detail);
    return detail;
  });
}

export function getClaudeTokenUsage(project: Project): ClaudeTokenUsage {
  const details = getClaudeSessionDetails(project);
  return details.reduce(
    (acc, d) => ({
      inputTokens: acc.inputTokens + d.tokens.inputTokens,
      outputTokens: acc.outputTokens + d.tokens.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + d.tokens.cacheReadTokens,
      cacheCreationTokens: acc.cacheCreationTokens + d.tokens.cacheCreationTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  );
}

// ---- Global functions (analytics page) ----

export function getClaudeDailyActivity(projects: Project[], days = 90): ClaudeDailyActivity[] {
  const allPrompts = loadHistory();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const dayMap = new Map<string, number>();

  for (const p of allPrompts) {
    if (p.timestamp < cutoff) continue;
    const date = new Date(p.timestamp).toISOString().split('T')[0];
    dayMap.set(date, (dayMap.get(date) || 0) + 1);
  }

  // Fill in missing days
  const result: ClaudeDailyActivity[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const date = d.toISOString().split('T')[0];
    result.push({ date, promptCount: dayMap.get(date) || 0 });
  }

  return result;
}

export function getClaudeByProject(projects: Project[]): ClaudeProjectSummary[] {
  const allPrompts = loadHistory();
  const projectMap = new Map<string, { promptCount: number; sessions: Set<string>; lastActivity: number }>();

  for (const p of allPrompts) {
    const matched = matchProject(p.project, projects);
    if (!matched) continue;

    const existing = projectMap.get(matched.id);
    if (existing) {
      existing.promptCount++;
      existing.sessions.add(p.sessionId);
      existing.lastActivity = Math.max(existing.lastActivity, p.timestamp);
    } else {
      projectMap.set(matched.id, {
        promptCount: 1,
        sessions: new Set([p.sessionId]),
        lastActivity: p.timestamp,
      });
    }
  }

  return [...projectMap.entries()]
    .map(([projectId, data]) => {
      const project = projects.find(p => p.id === projectId)!;
      return {
        projectId,
        projectName: project.name,
        promptCount: data.promptCount,
        sessionCount: data.sessions.size,
        lastActivity: data.lastActivity,
      };
    })
    .sort((a, b) => b.promptCount - a.promptCount);
}

export function getClaudeGlobalSummary(projects: Project[]): ClaudeGlobalSummary {
  const allPrompts = loadHistory();
  const byProject = getClaudeByProject(projects);
  const dailyActivity = getClaudeDailyActivity(projects, 90);

  // Count all unique sessions
  const allSessions = new Set(allPrompts.map(p => p.sessionId));

  // Count unregistered prompts
  let registeredCount = 0;
  for (const p of allPrompts) {
    if (matchProject(p.project, projects)) registeredCount++;
  }
  const unregisteredPrompts = allPrompts.length - registeredCount;

  // Most active project
  const mostActiveProject = byProject.length > 0
    ? { id: byProject[0].projectId, name: byProject[0].projectName, promptCount: byProject[0].promptCount }
    : null;

  return {
    totalPrompts: allPrompts.length,
    totalSessions: allSessions.size,
    mostActiveProject,
    dailyActivity,
    byProject,
    unregisteredPrompts,
  };
}
