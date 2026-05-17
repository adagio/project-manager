export const prerender = false;
import type { APIRoute } from 'astro';
import { deleteTask } from '@/lib/data/tasks';

function backTo(request: Request, fallback = '/tareas'): string {
  return request.headers.get('referer') ?? fallback;
}

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const id = (form.get('id') as string)?.trim();
  if (!id) return redirect(`${backTo(request)}?error=missing-id`);

  await deleteTask(id);
  return redirect(backTo(request));
};
