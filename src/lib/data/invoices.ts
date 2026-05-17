import { db } from '../db/index';
import { invoices, invoiceItems } from '../db/schema';
import { eq, desc } from 'drizzle-orm';

export async function getInvoices(projectId?: string) {
  if (projectId) {
    return await db.select().from(invoices)
      .where(eq(invoices.projectId, projectId))
      .orderBy(desc(invoices.date));
  }
  return await db.select().from(invoices).orderBy(desc(invoices.date));
}

export async function getInvoice(id: string) {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!invoice) return null;
  const items = await db.select().from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, id));
  return { ...invoice, items };
}

export async function addInvoice(invoice: {
  projectId: string;
  number?: string;
  type?: string;
  date: string;
  dueDate?: string;
  amount: number;
  currency?: string;
  status?: string;
  notes?: string;
  items?: { description: string; hours?: number; rate?: number; amount: number }[];
}) {
  const id = `inv-${Date.now()}`;
  await db.insert(invoices).values({
    id,
    projectId: invoice.projectId,
    number: invoice.number ?? null,
    type: invoice.type ?? 'hourly',
    date: invoice.date,
    dueDate: invoice.dueDate ?? null,
    amount: invoice.amount,
    currency: invoice.currency ?? 'USD',
    status: invoice.status ?? 'draft',
    notes: invoice.notes ?? null,
  });

  if (invoice.items) {
    for (const item of invoice.items) {
      await db.insert(invoiceItems).values({
        id: `ii-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        invoiceId: id,
        description: item.description,
        hours: item.hours ?? null,
        rate: item.rate ?? null,
        amount: item.amount,
      });
    }
  }

  return id;
}

export async function updateInvoiceStatus(id: string, status: string, paidDate?: string) {
  await db.update(invoices)
    .set({ status, paidDate: paidDate ?? null })
    .where(eq(invoices.id, id));
}

export async function getInvoiceSummary(projectId?: string) {
  const all = await getInvoices(projectId);
  const paid = all.filter(i => i.status === 'paid');
  const pending = all.filter(i => i.status === 'sent' || i.status === 'draft');
  const overdue = all.filter(i => i.status === 'overdue');

  return {
    totalInvoiced: all.reduce((s, i) => s + i.amount, 0),
    totalPaid: paid.reduce((s, i) => s + i.amount, 0),
    totalPending: pending.reduce((s, i) => s + i.amount, 0),
    totalOverdue: overdue.reduce((s, i) => s + i.amount, 0),
    count: all.length,
  };
}
