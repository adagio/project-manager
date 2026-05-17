import { getTimeEntries } from './time-entries';
import { getInvoices } from './invoices';
import { getEffectiveRate } from './settings';
import { db } from '../db/index';
import { fixedPayments, projectConfig } from '../db/schema';
import { eq, and, lte, or, isNull } from 'drizzle-orm';

export interface ProjectFinancials {
  projectId: string;
  totalHours: number;
  effectiveRate: number;
  earnedAmount: number;
  fixedAmount: number;
  invoicedAmount: number;
  paidAmount: number;
  pendingAmount: number;
}

export interface IncomeReport {
  period: { from: string; to: string };
  byProject: ProjectFinancials[];
  totalEarned: number;
  totalFixed: number;
  totalPaid: number;
  totalPending: number;
}

export async function getProjectFinancials(projectId: string, from?: string, to?: string): Promise<ProjectFinancials> {
  const entries = await getTimeEntries(projectId, from, to);
  const totalHours = entries.reduce((s, e) => s + e.hours, 0);
  const effectiveRate = await getEffectiveRate(projectId);
  const earnedAmount = totalHours * effectiveRate;

  // Fixed payments in period
  let fixedAmount = 0;
  const fixed = await getActiveFixedPayments(projectId, from);
  for (const fp of fixed) {
    if (from && to) {
      const months = countMonthsInRange(from, to, fp.period);
      fixedAmount += fp.amount * months;
    } else {
      fixedAmount += fp.amount;
    }
  }

  const allInvoices = await getInvoices(projectId);
  const periodInvoices = from && to
    ? allInvoices.filter(i => i.date >= from && i.date <= to)
    : allInvoices;

  const invoicedAmount = periodInvoices.reduce((s, i) => s + i.amount, 0);
  const paidAmount = periodInvoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
  const pendingAmount = invoicedAmount - paidAmount;

  return {
    projectId,
    totalHours,
    effectiveRate,
    earnedAmount,
    fixedAmount,
    invoicedAmount,
    paidAmount,
    pendingAmount,
  };
}

export async function getIncomeReport(projectIds: string[], from: string, to: string): Promise<IncomeReport> {
  const byProject = await Promise.all(projectIds.map(id => getProjectFinancials(id, from, to)));

  return {
    period: { from, to },
    byProject,
    totalEarned: byProject.reduce((s, p) => s + p.earnedAmount, 0),
    totalFixed: byProject.reduce((s, p) => s + p.fixedAmount, 0),
    totalPaid: byProject.reduce((s, p) => s + p.paidAmount, 0),
    totalPending: byProject.reduce((s, p) => s + p.pendingAmount, 0),
  };
}

async function getActiveFixedPayments(projectId: string, asOfDate?: string) {
  const dateFilter = asOfDate || new Date().toISOString().split('T')[0];
  return await db.select().from(fixedPayments)
    .where(
      and(
        eq(fixedPayments.projectId, projectId),
        lte(fixedPayments.startDate, dateFilter),
        or(isNull(fixedPayments.endDate), lte(dateFilter, fixedPayments.endDate!)),
      )
    );
}

function countMonthsInRange(from: string, to: string, period: string): number {
  const start = new Date(from);
  const end = new Date(to);
  const diffMs = end.getTime() - start.getTime();
  const diffDays = diffMs / 86400000;

  if (period === 'biweekly') return Math.ceil(diffDays / 14);
  return Math.max(1, Math.ceil(diffDays / 30));
}

// --- Yearly Income Report ---

export interface MonthlyIncome {
  projectId: string;
  projectName: string;
  color: string;
  paymentType: string;
  months: number[]; // 12 values, index 0 = Jan
  total: number;
}

export interface YearlyIncomeReport {
  year: number;
  projects: MonthlyIncome[];
  monthlyTotals: number[]; // 12 values
  grandTotal: number;
  totalPending: number;
}

/**
 * Calculate yearly income by project by month.
 * Combines fixed payments + invoice amounts.
 */
export async function getYearlyIncome(
  projects: { id: string; name: string; tabColor?: string }[],
  year: number,
): Promise<YearlyIncomeReport> {
  const result: MonthlyIncome[] = [];

  for (const project of projects) {
    const [config] = await db.select().from(projectConfig)
      .where(eq(projectConfig.projectId, project.id)).limit(1);
    if (!config) continue;

    const paymentType = config.paymentType || 'hourly';
    const months = new Array(12).fill(0);

    const fps = await db.select().from(fixedPayments)
      .where(eq(fixedPayments.projectId, project.id));

    for (const fp of fps) {
      const fpStart = new Date(fp.startDate);
      const fpEnd = fp.endDate ? new Date(fp.endDate) : null;

      for (let m = 0; m < 12; m++) {
        const monthStart = new Date(year, m, 1);
        const monthEnd = new Date(year, m + 1, 0); // last day of month

        if (monthStart >= fpStart && (!fpEnd || monthEnd <= fpEnd)) {
          if (fp.period === 'monthly') {
            months[m] += fp.amount;
          } else if (fp.period === 'biweekly') {
            months[m] += fp.amount * 2;
          }
        }
      }
    }

    const projectInvoices = await getInvoices(project.id);
    for (const inv of projectInvoices) {
      const invDate = new Date(inv.date);
      if (invDate.getFullYear() !== year) continue;
      months[invDate.getMonth()] += inv.amount;
    }

    const total = months.reduce((a, b) => a + b, 0);
    if (total > 0 || fps.length > 0) {
      result.push({
        projectId: project.id,
        projectName: project.name,
        color: project.tabColor || '#94a3b8',
        paymentType,
        months,
        total,
      });
    }
  }

  result.sort((a, b) => b.total - a.total);

  const monthlyTotals = new Array(12).fill(0);
  for (const p of result) {
    for (let m = 0; m < 12; m++) {
      monthlyTotals[m] += p.months[m];
    }
  }

  // Pending invoices (all time for this year)
  const allInvoices = await getInvoices();
  const yearPending = allInvoices
    .filter(i => new Date(i.date).getFullYear() === year && (i.status === 'sent' || i.status === 'draft'))
    .reduce((s, i) => s + i.amount, 0);

  return {
    year,
    projects: result,
    monthlyTotals,
    grandTotal: monthlyTotals.reduce((a, b) => a + b, 0),
    totalPending: yearPending,
  };
}
