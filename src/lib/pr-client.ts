import { execSync } from 'node:child_process';
import type { Project } from './types';
import { TTLCache } from './cache';

const prCache = new TTLCache<PR[]>(5 * 60 * 1000); // 5 min

export interface PR {
  number: string;
  title: string;
  state: 'open' | 'merged' | 'closed';
  date: string;
  branch: string;
  url?: string;
}

interface RepoInfo {
  type: 'github' | 'bitbucket';
  owner: string;
  repo: string;
}

/**
 * Extract owner/repo from repoUrl.
 * git@github.com-fintechlab:Fintechlab-Latam/FTL-Trace-TX.git → github, Fintechlab-Latam/FTL-Trace-TX
 * git@bitbucket.org:egnios/smac-control.git → bitbucket, egnios/smac-control
 */
export function parseRepoUrl(repoUrl: string): RepoInfo | null {
  // SSH format: git@host:owner/repo.git
  const sshMatch = repoUrl.match(/git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    const host = sshMatch[1];
    const ownerRepo = sshMatch[2];
    const [owner, repo] = ownerRepo.split('/');

    if (host.includes('bitbucket')) {
      return { type: 'bitbucket', owner, repo };
    }
    // Any github.com variant (github.com, github.com-fintechlab, etc.)
    if (host.includes('github')) {
      return { type: 'github', owner, repo };
    }
  }

  // HTTPS format
  const httpsMatch = repoUrl.match(/https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) {
    const host = httpsMatch[1];
    const owner = httpsMatch[2];
    const repo = httpsMatch[3];
    if (host.includes('bitbucket')) return { type: 'bitbucket', owner, repo };
    if (host.includes('github')) return { type: 'github', owner, repo };
  }

  return null;
}

function getGitHubPRs(owner: string, repo: string, limit = 10): PR[] {
  try {
    const output = execSync(
      `gh pr list --repo ${owner}/${repo} --state all --limit ${limit} --json number,title,state,createdAt,headRefName,url`,
      { encoding: 'utf-8', timeout: 15000, shell: true },
    ).trim();

    if (!output) return [];

    const prs = JSON.parse(output) as Array<{
      number: number;
      title: string;
      state: string;
      createdAt: string;
      headRefName: string;
      url: string;
    }>;

    return prs.map(pr => ({
      number: `#${pr.number}`,
      title: pr.title,
      state: pr.state.toLowerCase() as PR['state'],
      date: pr.createdAt,
      branch: pr.headRefName,
      url: pr.url,
    }));
  } catch {
    return [];
  }
}

function getBitbucketPRs(owner: string, repo: string, limit = 10): PR[] {
  try {
    // Bitbucket REST API 2.0 — requires app password or token in ~/.netrc
    const output = execSync(
      `curl -s "https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/pullrequests?state=MERGED&state=OPEN&state=DECLINED&pagelen=${limit}&sort=-created_on"`,
      { encoding: 'utf-8', timeout: 15000, shell: true },
    ).trim();

    if (!output) return [];
    const data = JSON.parse(output);
    if (!data.values) return [];

    return data.values.map((pr: any) => ({
      number: `#${pr.id}`,
      title: pr.title,
      state: pr.state === 'MERGED' ? 'merged' : pr.state === 'OPEN' ? 'open' : 'closed',
      date: pr.created_on,
      branch: pr.source?.branch?.name || '',
      url: pr.links?.html?.href,
    }));
  } catch {
    return [];
  }
}

export function getPRs(project: Project, limit = 10): PR[] {
  if (!project.repoUrl) return [];

  const cached = prCache.get(project.id);
  if (cached) return cached;

  const info = parseRepoUrl(project.repoUrl);
  if (!info) return [];

  let prs: PR[];
  if (info.type === 'github') {
    prs = getGitHubPRs(info.owner, info.repo, limit);
  } else {
    prs = getBitbucketPRs(info.owner, info.repo, limit);
  }

  prCache.set(project.id, prs);
  return prs;
}

export function getAllPRs(projects: Project[], limit = 10): Map<string, PR[]> {
  const result = new Map<string, PR[]>();
  for (const p of projects) {
    if (p.repoUrl) {
      result.set(p.id, getPRs(p, limit));
    }
  }
  return result;
}
