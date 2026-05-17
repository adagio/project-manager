export const prerender = false;
import type { APIRoute } from 'astro';
import { db } from '@/lib/db/index';
import { invoices } from '@/lib/db/schema';

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();

  const projectId = form.get('projectId') as string;
  const month = form.get('month') as string; // "2026-03"
  const hours = parseFloat(form.get('hours') as string);
  const amount = parseFloat(form.get('amount') as string);
  const status = (form.get('status') as string) || 'paid';
  const currency = (form.get('currency') as string) || 'USD';

  if (!projectId || !month || isNaN(hours) || isNaN(amount)) {
    return redirect(`/proyecto/${projectId}?error=invalid`);
  }

  const id = `inv-${Date.now()}`;
  const date = `${month}-01`;

  await db.insert(invoices).values({
    id,
    projectId,
    number: month,
    type: 'hourly',
    date,
    amount,
    currency,
    status,
    notes: JSON.stringify({ hours }),
  });

  return redirect(`/proyecto/${projectId}`);
};
