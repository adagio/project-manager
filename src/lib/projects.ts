import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ProjectRegistry, Project, Category } from './types';
import { db } from './db/index';
import { companies, projectConfig } from './db/schema';
import { eq } from 'drizzle-orm';
import { TTLCache } from './cache';

const registryCache = new TTLCache<ProjectRegistry>(30 * 1000); // 30s

function loadRegistry(): ProjectRegistry {
  const cached = registryCache.get('registry');
  if (cached) return cached;

  const filePath = resolve(process.cwd(), 'projects.json');
  const raw = readFileSync(filePath, 'utf-8');
  const registry = JSON.parse(raw) as ProjectRegistry;
  registryCache.set('registry', registry);
  return registry;
}

export function getRegistry(): ProjectRegistry {
  return loadRegistry();
}

export function getProjects(): Project[] {
  return loadRegistry().projects;
}

export function getProject(id: string): Project | undefined {
  return loadRegistry().projects.find(p => p.id === id);
}

export function getCategory(id: string): Category | undefined {
  return loadRegistry().categories.find(c => c.id === id);
}

export async function getCompanyName(projectId: string): Promise<string | null> {
  const [config] = await db.select().from(projectConfig)
    .where(eq(projectConfig.projectId, projectId)).limit(1);
  if (!config?.companyId) return null;

  const [company] = await db.select().from(companies)
    .where(eq(companies.id, config.companyId)).limit(1);
  return company?.name ?? null;
}

export async function getProjectStatus(projectId: string): Promise<string> {
  const [config] = await db.select().from(projectConfig)
    .where(eq(projectConfig.projectId, projectId)).limit(1);
  return config?.status ?? 'active';
}

export async function getProjectsByCategory(): Promise<Map<Category, { company: string | null; projects: Project[] }[]>> {
  const registry = loadRegistry();
  const result = new Map<Category, { company: string | null; projects: Project[] }[]>();

  for (const cat of registry.categories) {
    const catProjects = registry.projects.filter(p => p.category === cat.id);
    if (catProjects.length === 0) continue;

    const companyGroups = new Map<string | null, Project[]>();
    for (const p of catProjects) {
      const companyName = (await getCompanyName(p.id)) ?? p.company ?? null;
      if (!companyGroups.has(companyName)) companyGroups.set(companyName, []);
      companyGroups.get(companyName)!.push(p);
    }

    const groups: { company: string | null; projects: Project[] }[] = [];
    for (const [company, projects] of companyGroups) {
      groups.push({ company, projects });
    }

    result.set(cat, groups);
  }

  return result;
}
