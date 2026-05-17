export const prerender = false;
import type { APIRoute } from 'astro';
import { isRefreshing, getLastRefreshAt, getRefreshStartedAt } from '@/lib/git-client';

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({
      refreshing: isRefreshing(),
      lastRefreshAt: getLastRefreshAt(),
      refreshStartedAt: getRefreshStartedAt(),
    }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );
