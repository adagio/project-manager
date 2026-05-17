import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GitCommit, GitStatus, Project } from './types';
import { TTLCache } from './cache';

const EXEC_OPTS = { encoding: 'utf-8' as const, timeout: 15000, shell: true };
const REPOS_DIR = resolve(process.cwd(), 'repos');

// Caches
const pullCache = new TTLCache<string>(5 * 60 * 1000);   // 5 min — network pulls
const statusCache = new TTLCache<GitStatus>(60 * 1000);   // 60s — git status
const commitsCache = new TTLCache<GitCommit[]>(60 * 1000); // 60s — recent commits
const activityCache = new TTLCache<Map<string, number>>(60 * 1000); // 60s — heatmap

function gitExec(cmd: string, cwd: string): string {
  return execSync(cmd, { ...EXEC_OPTS, cwd }).trim();
}

let projectLabelWidth = 12;

function logWithPrefix(projectId: string, raw: string, stream: 'stdout' | 'stderr') {
  if (!raw) return;
  const label = `[${projectId}]`.padEnd(projectLabelWidth + 2);
  const target = stream === 'stderr' ? console.error : console.log;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.replace(/\s+$/, '');
    if (trimmed) target(`${label} ${trimmed}`);
  }
}

/**
 * Async, non-blocking. Streams stdout/stderr line-by-line through the
 * project-prefixed logger and resolves with the collected output + exit code.
 */
function runVerboseAsync(cmd: string, projectId: string, cwd: string | undefined, timeout: number): Promise<{ stdout: string; stderr: string; code: number | null }> {
  if (projectId.length + 2 > projectLabelWidth) projectLabelWidth = projectId.length;
  return new Promise((resolveOuter) => {
    const child = spawn(cmd, { shell: true, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch { /* ignore */ }
    }, timeout);

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      stdoutChunks.push(chunk);
      logWithPrefix(projectId, chunk, 'stdout');
    });
    child.stderr.on('data', (chunk: string) => {
      stderrChunks.push(chunk);
      logWithPrefix(projectId, chunk, 'stderr');
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveOuter({
        stdout: stdoutChunks.join(''),
        stderr: stderrChunks.join(''),
        code: timedOut ? null : code,
      });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      logWithPrefix(projectId, String(err.message || err), 'stderr');
      resolveOuter({ stdout: stdoutChunks.join(''), stderr: stderrChunks.join(''), code: null });
    });
  });
}

async function gitExecVerboseAsync(cmd: string, cwd: string, projectId: string, timeout = EXEC_OPTS.timeout): Promise<string> {
  const { stdout, stderr, code } = await runVerboseAsync(cmd, projectId, cwd, timeout);
  if (code !== 0) {
    const err = new Error(`git command failed (status ${code}): ${cmd}\n${stderr}`);
    (err as any).stdout = stdout;
    (err as any).stderr = stderr;
    throw err;
  }
  return stdout.trim();
}

async function gitCloneVerboseAsync(repoUrl: string, dest: string, projectId: string, branch: string | undefined, timeout = 120000): Promise<void> {
  const cmd = branch
    ? `git clone --branch ${branch} --single-branch "${repoUrl}" "${dest}"`
    : `git clone "${repoUrl}" "${dest}"`;
  const { stderr, code } = await runVerboseAsync(cmd, projectId, undefined, timeout);
  if (code !== 0) {
    throw new Error(`git clone failed (status ${code}): ${stderr}`);
  }
}

if (!existsSync(REPOS_DIR)) {
  mkdirSync(REPOS_DIR, { recursive: true });
}

/**
 * Get the local monitoring repo path for a project.
 * Clones if not present. Pulls at most once per 5 minutes.
 */
export function getRepoPath(project: Project): string | null {
  if (!project.repoUrl) return null;

  const repoDir = join(REPOS_DIR, project.id);
  const baseBranch = project.baseBranch || 'main';

  if (!existsSync(join(repoDir, '.git'))) {
    try {
      execSync(
        `git clone --branch ${baseBranch} --single-branch "${project.repoUrl}" "${repoDir}"`,
        { ...EXEC_OPTS, timeout: 60000 },
      );
    } catch {
      try {
        execSync(
          `git clone "${project.repoUrl}" "${repoDir}"`,
          { ...EXEC_OPTS, timeout: 60000 },
        );
        try { gitExec(`git checkout ${baseBranch}`, repoDir); } catch { /* stay on default */ }
      } catch {
        return null;
      }
    }
    pullCache.set(project.id, repoDir);
    return repoDir;
  }

  // Only pull if cache expired
  if (!pullCache.has(project.id)) {
    try {
      gitExec(`git checkout ${baseBranch}`, repoDir);
      gitExec('git pull --ff-only', repoDir);
    } catch {
      try { gitExec('git fetch', repoDir); } catch { /* offline */ }
    }
    pullCache.set(project.id, repoDir);
  }

  return repoDir;
}

/**
 * Non-blocking variant: returns the local repo path if it already exists.
 * Never clones, never pulls. Use this on render paths so requests stay fast;
 * call kickoffRepoRefresh() separately to update repos in the background.
 */
export function getRepoPathCached(project: Project): string | null {
  if (!project.repoUrl) return null;
  const repoDir = join(REPOS_DIR, project.id);
  return existsSync(join(repoDir, '.git')) ? repoDir : null;
}

// ---- Background repo refresh -------------------------------------------------

let refreshPromise: Promise<void> | null = null;
let refreshStartedAt: number | null = null;
let lastRefreshAt: number | null = null;
const REFRESH_DEBOUNCE_MS = 60 * 1000;

async function refreshOne(project: Project): Promise<void> {
  if (!project.repoUrl) return;
  const repoDir = join(REPOS_DIR, project.id);
  const baseBranch = project.baseBranch || 'main';

  if (!existsSync(join(repoDir, '.git'))) {
    try {
      await gitCloneVerboseAsync(project.repoUrl, repoDir, project.id, baseBranch);
    } catch {
      try {
        await gitCloneVerboseAsync(project.repoUrl, repoDir, project.id, undefined);
        try { await gitExecVerboseAsync(`git checkout ${baseBranch}`, repoDir, project.id); } catch { /* stay on default */ }
      } catch {
        return;
      }
    }
    pullCache.set(project.id, repoDir);
    return;
  }

  if (!pullCache.has(project.id)) {
    try {
      await gitExecVerboseAsync(`git checkout ${baseBranch}`, repoDir, project.id);
      await gitExecVerboseAsync('git pull --ff-only', repoDir, project.id);
    } catch {
      try { await gitExecVerboseAsync('git fetch', repoDir, project.id); } catch { /* offline */ }
    }
    pullCache.set(project.id, repoDir);
  }
}

async function runRefresh(projects: Project[], concurrency = 2): Promise<void> {
  const queue = [...projects];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const p = queue.shift();
      if (!p) break;
      try { await refreshOne(p); } catch { /* swallow per-project errors */ }
    }
  });
  await Promise.all(workers);
}

/**
 * Fire-and-forget: starts a background refresh of all repos if none is running
 * and the last refresh completed more than REFRESH_DEBOUNCE_MS ago.
 */
export function kickoffRepoRefresh(projects: Project[]): void {
  if (refreshPromise) return;
  const now = Date.now();
  if (lastRefreshAt && now - lastRefreshAt < REFRESH_DEBOUNCE_MS) return;
  refreshStartedAt = now;
  refreshPromise = runRefresh(projects).finally(() => {
    lastRefreshAt = Date.now();
    refreshStartedAt = null;
    refreshPromise = null;
    // Invalidate per-render caches so the next render sees fresh data
    statusCache.clear?.();
    commitsCache.clear?.();
    activityCache.clear?.();
  });
}

export function isRefreshing(): boolean {
  return refreshPromise !== null;
}

export function getLastRefreshAt(): number | null {
  return lastRefreshAt;
}

export function getRefreshStartedAt(): number | null {
  return refreshStartedAt;
}

export function isGitRepo(path: string): boolean {
  return existsSync(join(path, '.git'));
}

const BASE_BRANCH_CANDIDATES = ['develop', 'development', 'main', 'master'];

export function getBranches(repoPath: string): string[] {
  if (!isGitRepo(repoPath)) return [];
  try {
    const output = gitExec('git branch --format="%(refname:short)"', repoPath);
    return output ? output.split('\n').map(b => b.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function detectBaseBranch(repoPath: string, currentBranch: string): string | null {
  const branches = getBranches(repoPath);
  for (const candidate of BASE_BRANCH_CANDIDATES) {
    if (branches.includes(candidate) && candidate !== currentBranch) {
      return candidate;
    }
  }
  for (const candidate of BASE_BRANCH_CANDIDATES) {
    if (branches.includes(candidate)) return candidate;
  }
  return null;
}

export function getGitStatus(repoPath: string): GitStatus {
  const empty: GitStatus = {
    branch: '', baseBranch: null, ahead: 0, behind: 0,
    aheadOfBase: 0, behindBase: 0, modified: 0, untracked: 0,
    lastCommitDate: null, lastCommitMessage: null, isRepo: false,
  };

  if (!isGitRepo(repoPath)) return empty;

  const cached = statusCache.get(repoPath);
  if (cached) return cached;

  try {
    const branch = gitExec('git rev-parse --abbrev-ref HEAD', repoPath);
    const baseBranch = detectBaseBranch(repoPath, branch);

    let ahead = 0;
    let behind = 0;
    try {
      const abStr = gitExec('git rev-list --left-right --count HEAD...@{upstream}', repoPath);
      const parts = abStr.split(/\s+/);
      ahead = parseInt(parts[0] || '0', 10);
      behind = parseInt(parts[1] || '0', 10);
    } catch { /* no upstream */ }

    let aheadOfBase = 0;
    let behindBase = 0;
    if (baseBranch && baseBranch !== branch) {
      try {
        const abStr = gitExec(`git rev-list --left-right --count HEAD...${baseBranch}`, repoPath);
        const parts = abStr.split(/\s+/);
        aheadOfBase = parseInt(parts[0] || '0', 10);
        behindBase = parseInt(parts[1] || '0', 10);
      } catch { /* branch might not share history */ }
    }

    const statusOutput = gitExec('git status --porcelain', repoPath);
    const lines = statusOutput ? statusOutput.split('\n') : [];
    const modified = lines.filter(l => !l.startsWith('??')).length;
    const untracked = lines.filter(l => l.startsWith('??')).length;

    let lastCommitDate: string | null = null;
    let lastCommitMessage: string | null = null;
    try {
      const logLine = gitExec('git log -1 --format="%aI|%s"', repoPath);
      const sepIdx = logLine.indexOf('|');
      if (sepIdx > 0) {
        lastCommitDate = logLine.substring(0, sepIdx);
        lastCommitMessage = logLine.substring(sepIdx + 1);
      }
    } catch { /* empty repo */ }

    const result: GitStatus = {
      branch, baseBranch, ahead, behind, aheadOfBase, behindBase,
      modified, untracked, lastCommitDate, lastCommitMessage, isRepo: true,
    };
    statusCache.set(repoPath, result);
    return result;
  } catch {
    return empty;
  }
}

export function getRecentCommits(repoPath: string, limit = 20, allBranches = true): GitCommit[] {
  if (!isGitRepo(repoPath)) return [];

  const cacheKey = `${repoPath}:${limit}:${allBranches}`;
  const cached = commitsCache.get(cacheKey);
  if (cached) return cached;

  try {
    const allFlag = allBranches ? '--all' : '';
    const output = gitExec(
      `git log ${allFlag} -${limit} --format="%H|%an|%aI|%s"`,
      repoPath,
    );
    if (!output) return [];

    const result = output.split('\n').map(line => {
      const [hash, author, date, ...msgParts] = line.split('|');
      return {
        hash: hash.substring(0, 8),
        author,
        date,
        message: msgParts.join('|'),
      };
    });
    commitsCache.set(cacheKey, result);
    return result;
  } catch {
    return [];
  }
}

export function getCommitActivity(repoPath: string, days = 90): Map<string, number> {
  if (!isGitRepo(repoPath)) return new Map();

  const cacheKey = `${repoPath}:${days}`;
  const cached = activityCache.get(cacheKey);
  if (cached) return cached;

  const activity = new Map<string, number>();
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().split('T')[0];

    const output = gitExec(
      `git log --all --since="${sinceStr}" --format="%ad" --date=short`,
      repoPath,
    );
    if (!output) return activity;

    for (const date of output.split('\n')) {
      activity.set(date, (activity.get(date) || 0) + 1);
    }
  } catch { /* ignore */ }

  activityCache.set(cacheKey, activity);
  return activity;
}
