import { supabase } from '@/src/services/supabase';

export class NotificationsApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'NotificationsApiError';
  }
}

export type NotificationCategory = 'social' | 'task' | 'account' | 'security' | 'promo';

export type NotificationActor = {
  id: string;
  username: string;
  displayName: string | null;
  profilePhotoUrl: string | null;
};

/** Mirrors the server's NotificationView; text is already rendered server-side. */
export type NotificationItem = {
  id: string;
  type: string;
  category: NotificationCategory;
  title: string;
  body: string;
  deepLink: string;
  actors: NotificationActor[];
  actorCount: number;
  read: boolean;
  seen: boolean;
  createdAt: string;
  updatedAt: string;
};

export type NotificationsPage = {
  items: NotificationItem[];
  nextCursor: string | null;
  headCursor: string | null;
};

export type UnreadCount = { unread: number; capped: boolean };

function apiBase(): string {
  const base = process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\/$/, '');
  if (!base) throw new NotificationsApiError('Mystash service is not configured.', 500);
  return base;
}

async function bearerToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new NotificationsApiError('Not authenticated', 401);
  return token;
}

async function authedJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await bearerToken();
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new NotificationsApiError(body.error ?? `Notifications request failed (${res.status})`, res.status);
  }
  return (await res.json()) as T;
}

export async function listNotifications(params: { cursor?: string | null; limit?: number } = {}): Promise<NotificationsPage> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  const page = await authedJson<Partial<NotificationsPage>>(`/users/me/notifications${qs ? `?${qs}` : ''}`);
  return {
    items: Array.isArray(page.items) ? page.items : [],
    nextCursor: page.nextCursor ?? null,
    headCursor: page.headCursor ?? null,
  };
}

export async function fetchUnreadCount(): Promise<UnreadCount> {
  const body = await authedJson<Partial<UnreadCount>>('/users/me/notifications/unread-count');
  return { unread: Math.max(0, Number(body.unread) || 0), capped: Boolean(body.capped) };
}

export async function markNotificationsRead(
  selector: { ids: string[] } | { all: true; before?: string | null },
): Promise<number> {
  const body =
    'ids' in selector
      ? { ids: selector.ids }
      : { all: true, ...(selector.before ? { before: selector.before } : {}) };
  const res = await authedJson<{ updated?: number }>('/users/me/notifications/read', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.updated ?? 0;
}

export async function markNotificationsSeen(upTo: string): Promise<number> {
  const res = await authedJson<{ updated?: number }>('/users/me/notifications/seen', {
    method: 'POST',
    body: JSON.stringify({ upTo }),
  });
  return res.updated ?? 0;
}

/** `deliveryId` is set only for push taps (Phase 5); inbox taps omit it. */
export async function recordNotificationOpened(
  id: string,
  push?: { deliveryId: string; action?: string | null },
): Promise<void> {
  await authedJson<{ ok: boolean }>(`/users/me/notifications/${encodeURIComponent(id)}/opened`, {
    method: 'POST',
    ...(push ? { body: JSON.stringify({ deliveryId: push.deliveryId, action: push.action ?? null }) } : {}),
  });
}

export type PushRegistrationBody = {
  token: string;
  platform: 'ios' | 'android';
  osPermission: 'granted' | 'provisional' | 'denied' | 'undetermined';
  appVersion: string | null;
  appBuild: string | null;
  locale: string | null;
  timezone: string | null;
  apnsEnvironment: 'sandbox' | 'production' | null;
};

/**
 * `revocationCredential` authorizes only a sessionless unlink of this installation; it is
 * null while the server predates the revocation migration.
 */
export async function registerPushInstallation(
  installationId: string,
  body: PushRegistrationBody,
): Promise<{ revocationCredential: string | null }> {
  const res = await authedJson<{ registrationId: string; revocationCredential?: string | null }>(
    `/users/me/push-registrations/${encodeURIComponent(installationId)}`,
    { method: 'PUT', body: JSON.stringify({ provider: 'expo', ...body }) },
  );
  return { revocationCredential: res.revocationCredential ?? null };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Session-authenticated unlink; used while the user is still signed in. */
export async function unregisterPushInstallation(installationId: string, opts: { timeoutMs?: number } = {}): Promise<void> {
  const token = await bearerToken();
  const res = await fetchWithTimeout(
    `${apiBase()}/users/me/push-registrations/${encodeURIComponent(installationId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    opts.timeoutMs,
  );
  if (!res.ok) throw new NotificationsApiError(`Push unlink failed (${res.status})`, res.status);
}

/** Sessionless unlink with this installation's revocation credential; sends no auth header. */
export async function revokePushInstallation(
  installationId: string,
  credential: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ revoked: boolean }> {
  const res = await fetchWithTimeout(
    `${apiBase()}/push-registrations/${encodeURIComponent(installationId)}/revoke`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    },
    opts.timeoutMs,
  );
  if (!res.ok) throw new NotificationsApiError(`Push revoke failed (${res.status})`, res.status);
  const body = (await res.json().catch(() => ({}))) as { revoked?: boolean };
  return { revoked: body.revoked === true };
}

export type NotificationPreferencePair = {
  category: 'social' | 'task' | 'account' | 'promo';
  channel: 'inbox' | 'push';
  enabled: boolean;
  configurable: true;
};

export type NotificationSettings = {
  preferences: NotificationPreferencePair[];
  timezone: string;
  quietHours: { start: string; end: string } | null;
  promoOptedIn: boolean;
};

export async function fetchNotificationSettings(): Promise<NotificationSettings> {
  return authedJson<NotificationSettings>('/users/me/notification-settings');
}

export async function updateNotificationSettings(body: {
  preferences?: { category: string; channel: string; enabled: boolean }[];
  timezone?: string;
  quietHours?: { start: string; end: string } | null;
}): Promise<NotificationSettings> {
  return authedJson<NotificationSettings>('/users/me/notification-settings', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}
