export const prerender = false;
import type { APIRoute } from 'astro';
import { updateTask, parseTagsInput, parseEstimateInput, TASK_STATUSES, type TaskStatus } from '@/lib/data/tasks';

function backTo(request: Request, fallback = '/tareas'): string {
  return request.headers.get('referer') ?? fallback;
}

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();

  const id = (form.get('id') as string)?.trim();
  if (!id) return redirect(`${backTo(request)}?error=missing-id`);

  const projectId = (form.get('projectId') as string)?.trim();
  const title = (form.get('title') as string)?.trim();
  const description = (form.get('description') as string)?.trim() || null;
  const statusRaw = form.get('status') as string | null;
  const dueDate = (form.get('dueDate') as string)?.trim() || null;
  const estimateRaw = form.get('estimateHours') as string | null;
  const tagsRaw = form.get('tags') as string | null;

  const patch: Parameters<typeof updateTask>[1] = {};
  if (projectId) patch.projectId = projectId;
  if (title) patch.title = title;
  patch.description = description;
  if (statusRaw && (TASK_STATUSES as string[]).includes(statusRaw)) patch.status = statusRaw as TaskStatus;
  patch.dueDate = dueDate;
  if (estimateRaw !== null) patch.estimateHours = parseEstimateInput(estimateRaw);
  if (tagsRaw !== null) patch.tags = parseTagsInput(tagsRaw);

  await updateTask(id, patch);

  return redirect(backTo(request));
};
