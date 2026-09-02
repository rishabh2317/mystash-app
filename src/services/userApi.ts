import type { CreatorStatus, CreatorViewModel } from '@/src/types/creator';
import { mapPublicUserToCreatorViewModel } from '@/src/mappers/creatorMapper';
import { supabase } from '@/src/services/supabase';

export class UserApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly redirectToUsername?: string,
  ) {
    super(message);
    this.name = 'UserApiError';
  }
}

/** Authenticated settings projection from GET /users/me. */
export type UserSettingsViewModel = CreatorViewModel & {
  emailMirrored: string | null;
  accountStatus: string;
  country: string | null;
  language: string | null;
  timezone: string | null;
  authProvider: string | null;
  creatorStatus: CreatorStatus;
};

function apiBase(): string {
  const base = process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\/$/, '');
  if (!base) {
    throw new UserApiError('Mystash service is not configured.', 500);
  }
  return base;
}

async function bearerToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new UserApiError('Not authenticated', 401);
  }
  return token;
}

type UserSettingsDto = {
  id: string;
  username: string;
  displayName: string | null;
  profilePhotoUrl: string | null;
  bio: string | null;
  websiteUrl: string | null;
  socialLinks?: Record<string, string>;
  creatorStatus: CreatorStatus;
  isCreator: boolean;
  accountType: string;
  joinedAt: string;
  publicStats: {
    followersCount: number;
    followingCount: number;
    collectionCount: number;
    savesCount?: number;
  };
  emailMirrored: string | null;
  accountStatus: string;
  country: string | null;
  language: string | null;
  timezone: string | null;
  authProvider: string | null;
};

function mapSettings(user: UserSettingsDto): UserSettingsViewModel {
  return {
    ...mapPublicUserToCreatorViewModel(user),
    emailMirrored: user.emailMirrored,
    accountStatus: user.accountStatus,
    country: user.country,
    language: user.language,
    timezone: user.timezone,
    authProvider: user.authProvider,
    creatorStatus: user.creatorStatus,
  };
}

async function authedUserJson(
  path: string,
  init?: RequestInit,
): Promise<UserSettingsViewModel> {
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
    throw new UserApiError(body.error ?? `User API failed (${res.status})`, res.status);
  }
  const body = (await res.json()) as { user: UserSettingsDto };
  if (!body?.user) {
    throw new UserApiError('Invalid user response', 500);
  }
  return mapSettings(body.user);
}

/** Idempotent User row from Auth (creator_status stays NONE until onboarding). */
export async function ensureMe(): Promise<UserSettingsViewModel> {
  return authedUserJson('/users/me/ensure', { method: 'POST' });
}

export async function fetchMe(): Promise<UserSettingsViewModel> {
  return authedUserJson('/users/me', { method: 'GET' });
}

export async function updateMyProfile(patch: {
  displayName?: string | null;
  bio?: string | null;
  profilePhotoUrl?: string | null;
}): Promise<UserSettingsViewModel> {
  return authedUserJson('/users/me/profile', {
    method: 'PATCH',
    body: JSON.stringify({
      display_name: patch.displayName,
      bio: patch.bio,
      profile_photo_url: patch.profilePhotoUrl,
    }),
  });
}

/** NONE → ONBOARDING */
export async function startCreatorOnboarding(): Promise<UserSettingsViewModel> {
  return authedUserJson('/users/me/creator/start', { method: 'POST' });
}

/** ONBOARDING → ACTIVE */
export async function completeCreatorOnboarding(): Promise<UserSettingsViewModel> {
  return authedUserJson('/users/me/creator/complete', { method: 'POST' });
}

/** ONBOARDING → NONE */
export async function abandonCreatorOnboarding(): Promise<UserSettingsViewModel> {
  return authedUserJson('/users/me/creator/abandon', { method: 'POST' });
}

/**
 * Drive User → ACTIVE Creator via existing lifecycle APIs.
 * Does not bypass CollectionService; only flips creator_status.
 */
export async function activateCreatorAccount(opts?: {
  displayName?: string | null;
}): Promise<UserSettingsViewModel> {
  let me = await ensureMe();

  if (me.creatorStatus === 'ACTIVE') return me;
  if (me.creatorStatus === 'SUSPENDED') {
    throw new UserApiError('Creator privileges are suspended', 403);
  }

  const displayName = opts?.displayName?.trim();
  if (displayName && displayName !== (me.displayName ?? '')) {
    me = await updateMyProfile({ displayName });
  }

  if (me.creatorStatus === 'NONE') {
    me = await startCreatorOnboarding();
  }

  if (me.creatorStatus === 'ONBOARDING') {
    me = await completeCreatorOnboarding();
  }

  if (me.creatorStatus !== 'ACTIVE') {
    throw new UserApiError(`Could not activate creator (status=${me.creatorStatus})`, 500);
  }
  return me;
}

/**
 * Public Creator profile by username.
 * 301 → throws UserApiError with redirectToUsername.
 */
export async function fetchPublicCreatorByUsername(
  username: string,
): Promise<CreatorViewModel> {
  const handle = username.trim().replace(/^@/, '');
  if (!handle) {
    throw new UserApiError('Username is required', 400);
  }

  const res = await fetch(`${apiBase()}/users/by-username/${encodeURIComponent(handle)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    redirect: 'manual',
  });

  if (res.status === 301) {
    const body = (await res.json().catch(() => ({}))) as { redirect_to_username?: string };
    const next = body.redirect_to_username?.trim();
    throw new UserApiError('Username redirected', 301, next || undefined);
  }

  if (res.status === 404) {
    throw new UserApiError('Creator not found', 404);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new UserApiError(body.error ?? `Profile failed (${res.status})`, res.status);
  }

  const body = (await res.json()) as { user: Parameters<typeof mapPublicUserToCreatorViewModel>[0] };
  if (!body?.user) {
    throw new UserApiError('Invalid profile response', 500);
  }
  return mapPublicUserToCreatorViewModel(body.user);
}
