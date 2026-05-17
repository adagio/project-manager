export const prerender = false;
import type { APIRoute } from 'astro';
import { createTask, parseTagsInput, parseEstimateInput, TASK_STATUSES, type TaskStatus } from '@/lib/data/tasks';

function backTo(request: Request, fallback = '/tareas'): string {
  return request.headers.get('referer') ?? fallback;
}

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();

  const projectId = (form.get('projectId') as string)?.trim();
  const title = (form.get('title') as string)?.trim();
  const description = (form.get('description') as string)?.trim() || null;
  const statusRaw = (form.get('status') as string) || 'backlog';
  const status = (TASK_STATUSES as string[]).includes(statusRaw)
    ? (statusRaw as TaskStatus)
    : 'backlog';
  const dueDate = (form.get('dueDate') as string)?.trim() || null;
  const estimateHours = parseEstimateInput(form.get('estimateHours') as string | null);
  const tags = parseTagsInput((form.get('tags') as string) || '');

  if (!projectId || !title) {
    return redirect(`${backTo(request)}?error=missing-fields`);
  }

  await createTask({
    projectId,
    title,
    description,
    status,
    dueDate,
    estimateHours,
    tags,
  });

  return redirect(backTo(request));
};
