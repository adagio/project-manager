export const prerender = false;
import type { APIRoute } from 'astro';
import { changeTaskStatus, TASK_STATUSES, type TaskStatus } from '@/lib/data/tasks';

function backTo(request: Request, fallback = '/tareas'): string {
  return request.headers.get('referer') ?? fallback;
}

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const id = (form.get('id') as string)?.trim();
  const statusRaw = (form.get('status') as string)?.trim();

  if (!id || !(TASK_STATUSES as string[]).includes(statusRaw)) {
    return redirect(`${backTo(request)}?error=invalid-status`);
  }

  await changeTaskStatus(id, statusRaw as TaskStatus);

  return redirect(backTo(request));
};
