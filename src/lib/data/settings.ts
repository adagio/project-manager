import { db } from '../db/index';
import { settings, roles, projectConfig, projectRoles } from '../db/schema';
import { eq } from 'drizzle-orm';

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return row?.value ?? null;
}

export async function getDefaultHourlyRate(): Promise<number> {
  const val = await getSetting('defaultHourlyRate');
  return val ? parseFloat(val) : 0;
}

export async function getCurrency(): Promise<string> {
  return (await getSetting('currency')) ?? 'USD';
}

export async function getRoles() {
  return await db.select().from(roles);
}

export async function getRole(id: string) {
  const [row] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  return row ?? null;
}

/**
 * Resolve effective rate using cascade:
 * 1. project_roles.rateOverride (if role specified)
 * 2. project_config.rateOverride
 * 3. roles.defaultRate (if role specified)
 * 4. settings.defaultHourlyRate
 */
export async function getEffectiveRate(projectId: string, roleId?: string): Promise<number> {
  if (roleId) {
    const prRows = await db.select().from(projectRoles)
      .where(eq(projectRoles.projectId, projectId));
    const pr = prRows.find(r => r.roleId === roleId);
    if (pr?.rateOverride != null) return pr.rateOverride;
  }

  const [pc] = await db.select().from(projectConfig)
    .where(eq(projectConfig.projectId, projectId)).limit(1);
  if (pc?.rateOverride != null) return pc.rateOverride;

  if (roleId) {
    const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
    if (role?.defaultRate != null) return role.defaultRate;
  }

  return await getDefaultHourlyRate();
}
