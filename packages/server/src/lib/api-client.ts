/**
 * Client-side API helpers for the OpenThreads management dashboard.
 *
 * In development (no MANAGEMENT_API_KEY set), the server bypasses auth.
 * In production, set NEXT_PUBLIC_MANAGEMENT_API_KEY to authenticate.
 */

import type { Channel, CreateChannelInput } from '@openthreads/core';
import type { Route, CreateRouteInput, RouteCriteria } from '@openthreads/core';
import type { Recipient, CreateRecipientInput } from '@openthreads/core';
import type { Thread } from '@openthreads/core';
import type { Turn } from '@openthreads/core';
import type { AppSettings, ChannelOverride } from './db';

// Re-export types for convenience in client components
export type { Channel, Route, RouteCriteria, Recipient, Thread, Turn, AppSettings, ChannelOverride };
export type { CreateChannelInput, CreateRouteInput, CreateRecipientInput };

function buildHeaders(): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const key =
    typeof window !== 'undefined'
      ? (process.env.NEXT_PUBLIC_MANAGEMENT_API_KEY ?? '')
      : '';
  if (key) h['Authorization'] = `Bearer ${key}`;
  return h;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: { ...buildHeaders(), ...(options?.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

// ─── Channels ─────────────────────────────────────────────────────────────────

export const channelApi = {
  list: () =>
    apiFetch<{ channels: Channel[] }>('/api/channels').then((r) => r.channels),

  get: (id: string) =>
    apiFetch<{ channel: Channel }>(`/api/channels/${id}`).then((r) => r.channel),

  create: (input: Omit<CreateChannelInput, 'apiKey'>) =>
    apiFetch<{ channel: Channel }>('/api/channels', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((r) => r.channel),

  update: (id: string, input: Partial<Channel>) =>
    apiFetch<{ channel: Channel }>(`/api/channels/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }).then((r) => r.channel),

  delete: (id: string) =>
    apiFetch<void>(`/api/channels/${id}`, { method: 'DELETE' }),
};

// ─── Recipients ───────────────────────────────────────────────────────────────

export const recipientApi = {
  list: () =>
    apiFetch<{ recipients: Recipient[] }>('/api/recipients').then((r) => r.recipients),

  get: (id: string) =>
    apiFetch<{ recipient: Recipient }>(`/api/recipients/${id}`).then((r) => r.recipient),

  create: (input: CreateRecipientInput) =>
    apiFetch<{ recipient: Recipient }>('/api/recipients', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((r) => r.recipient),

  update: (id: string, input: Partial<Recipient>) =>
    apiFetch<{ recipient: Recipient }>(`/api/recipients/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }).then((r) => r.recipient),

  delete: (id: string) =>
    apiFetch<void>(`/api/recipients/${id}`, { method: 'DELETE' }),
};

// ─── Routes ───────────────────────────────────────────────────────────────────

export const routeApi = {
  list: () =>
    apiFetch<{ routes: Route[] }>('/api/routes').then((r) => r.routes),

  get: (id: string) =>
    apiFetch<{ route: Route }>(`/api/routes/${id}`).then((r) => r.route),

  create: (input: CreateRouteInput) =>
    apiFetch<{ route: Route }>('/api/routes', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((r) => r.route),

  update: (id: string, input: Partial<Route>) =>
    apiFetch<{ route: Route }>(`/api/routes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }).then((r) => r.route),

  delete: (id: string) =>
    apiFetch<void>(`/api/routes/${id}`, { method: 'DELETE' }),

  test: (criteria: Partial<RouteCriteria>) =>
    apiFetch<{ matchingRouteIds: string[]; routes: Route[] }>('/api/routes/test', {
      method: 'POST',
      body: JSON.stringify(criteria),
    }),
};

// ─── Threads ──────────────────────────────────────────────────────────────────

export const threadApi = {
  list: (params?: { channelId?: string; targetId?: string; search?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.channelId) qs.set('channelId', params.channelId);
    if (params?.targetId) qs.set('targetId', params.targetId);
    if (params?.search) qs.set('search', params.search);
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<{ threads: Thread[] }>(`/api/threads${query}`).then((r) => r.threads);
  },

  get: (threadId: string) =>
    apiFetch<{ thread: Thread }>(`/api/threads/${threadId}`).then((r) => r.thread),

  turns: (threadId: string) =>
    apiFetch<{ threadId: string; turns: Turn[] }>(`/api/threads/${threadId}/turns`).then(
      (r) => r.turns,
    ),
};

// ─── Settings ─────────────────────────────────────────────────────────────────

export const settingsApi = {
  get: () =>
    apiFetch<{ settings: AppSettings }>('/api/settings').then((r) => r.settings),

  update: (settings: Partial<AppSettings>) =>
    apiFetch<{ settings: AppSettings }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }).then((r) => r.settings),
};
