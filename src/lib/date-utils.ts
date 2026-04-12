export type RangeKey = 'today' | 'yesterday' | 'week' | 'month';

export interface DateRange {
  start: Date;
  end: Date;
  label: string;
}

export function getDateRange(range: RangeKey, offset = 0): DateRange {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (range) {
    case 'today': {
      const start = new Date(startOfToday);
      start.setDate(start.getDate() + offset);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      if (offset === 0) {
        return { start, end: now, label: 'Hoy' };
      }
      return { start, end, label: formatDateLabel(start) };
    }
    case 'yesterday': {
      const start = new Date(startOfToday);
      start.setDate(start.getDate() - 1 + offset);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      if (offset === 0) return { start, end, label: 'Ayer' };
      return { start, end, label: formatDateLabel(start) };
    }
    case 'week': {
      const start = new Date(startOfToday);
      const day = start.getDay();
      const diff = day === 0 ? 6 : day - 1;
      start.setDate(start.getDate() - diff + (offset * 7));
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      // Clamp end to now if it's the current week
      const clampedEnd = end > now ? now : end;
      if (offset === 0) return { start, end: clampedEnd, label: 'Esta semana' };
      return { start, end: clampedEnd, label: formatWeekLabel(start) };
    }
    case 'month': {
      const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      const clampedEnd = end > now ? now : end;
      if (offset === 0) return { start, end: clampedEnd, label: 'Este mes' };
      return { start, end: clampedEnd, label: formatMonthLabel(start) };
    }
  }
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatWeekLabel(weekStart: Date): string {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const s = weekStart.toLocaleDateString('es', { day: 'numeric', month: 'short' });
  const e = weekEnd.toLocaleDateString('es', { day: 'numeric', month: 'short' });
  return `${s} — ${e}`;
}

function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString('es', { month: 'long', year: 'numeric' });
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'ahora';
  if (diffMins < 60) return `hace ${diffMins}m`;
  if (diffHours < 24) return `hace ${diffHours}h`;
  if (diffDays < 7) return `hace ${diffDays}d`;
  if (diffDays < 30) return `hace ${Math.floor(diffDays / 7)} sem`;
  return `hace ${Math.floor(diffDays / 30)} mes${Math.floor(diffDays / 30) > 1 ? 'es' : ''}`;
}

export function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

export function formatTokenCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}
