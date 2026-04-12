import { execSync } from 'node:child_process';
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
