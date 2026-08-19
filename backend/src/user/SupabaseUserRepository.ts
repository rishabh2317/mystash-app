import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CreateUserInput,
  UpdateUserPatch,
  UserRepository,
} from './UserRepository';
import type {
  MaterializedUserCounters,
  User,
  UsernameReservation,
} from './domain/types';
import { USER_SCHEMA_VERSION } from './domain/types';

type UserRow = Record<string, unknown>;

function now(): string {
  return new Date().toISOString();
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function mapUser(row: UserRow): User {
  const social = row.social_links;
  return {
    id: String(row.id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    authProvider: (row.auth_provider as string | null) ?? null,
    username: String(row.username),
    displayName: (row.display_name as string | null) ?? null,
    profilePhotoUrl: (row.profile_photo_url as string | null) ?? null,
    bio: (row.bio as string | null) ?? null,
    websiteUrl: (row.website_url as string | null) ?? null,
    socialLinks:
      social && typeof social === 'object' && !Array.isArray(social)
        ? (social as Record<string, string>)
        : {},
    accountStatus: row.account_status as User['accountStatus'],
    creatorStatus: row.creator_status as User['creatorStatus'],
    accountType: (row.account_type as User['accountType']) ?? 'personal',
    country: (row.country as string | null) ?? null,
    language: (row.language as string | null) ?? null,
    timezone: (row.timezone as string | null) ?? null,
    joinedAt: String(row.joined_at),
    deletedAt: (row.deleted_at as string | null) ?? null,
    emailMirrored: (row.email_mirrored as string | null) ?? null,
    followersCount: Number(row.followers_count ?? 0),
    followingCount: Number(row.following_count ?? 0),
    collectionCount: Number(row.collection_count ?? 0),
    countersUpdatedAt: (row.counters_updated_at as string | null) ?? null,
    schemaVersion: Number(row.schema_version ?? USER_SCHEMA_VERSION),
    extensions:
      row.extensions && typeof row.extensions === 'object' && !Array.isArray(row.extensions)
        ? (row.extensions as Record<string, unknown>)
        : {},
  };
}

function mapReservation(row: UserRow): UsernameReservation {
  return {
    id: String(row.id),
    username: String(row.username),
    userId: String(row.user_id),
    redirectToUsername: String(row.redirect_to_username),
    reservedUntil: String(row.reserved_until),
    isActive: row.is_active !== false,
    createdAt: String(row.created_at),
  };
}

const PATCH_MAP: Record<string, string> = {
  authProvider: 'auth_provider',
  username: 'username',
  displayName: 'display_name',
  profilePhotoUrl: 'profile_photo_url',
  bio: 'bio',
  websiteUrl: 'website_url',
  socialLinks: 'social_links',
  accountStatus: 'account_status',
  creatorStatus: 'creator_status',
  accountType: 'account_type',
  country: 'country',
  language: 'language',
  timezone: 'timezone',
  deletedAt: 'deleted_at',
  emailMirrored: 'email_mirrored',
  followersCount: 'followers_count',
  followingCount: 'following_count',
  collectionCount: 'collection_count',
  countersUpdatedAt: 'counters_updated_at',
  schemaVersion: 'schema_version',
  extensions: 'extensions',
};

export class SupabaseUserRepository implements UserRepository {
  constructor(private readonly db: SupabaseClient) {}

  async insertUser(input: CreateUserInput): Promise<User> {
    const { data, error } = await this.db
      .from('users')
      .insert({
        id: input.id,
        auth_provider: input.authProvider ?? null,
        username: normalizeUsername(input.username),
        display_name: input.displayName ?? null,
        profile_photo_url: input.profilePhotoUrl ?? null,
        bio: input.bio ?? null,
        website_url: input.websiteUrl ?? null,
        social_links: input.socialLinks ?? {},
        account_status: input.accountStatus ?? 'ACTIVE',
        creator_status: input.creatorStatus ?? 'NONE',
        account_type: input.accountType ?? 'personal',
        country: input.country ?? null,
        language: input.language ?? null,
        timezone: input.timezone ?? null,
        email_mirrored: input.emailMirrored ?? null,
        schema_version: USER_SCHEMA_VERSION,
      })
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'insert user failed');
    return mapUser(data as UserRow);
  }

  async getById(id: string): Promise<User | null> {
    const { data, error } = await this.db.from('users').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapUser(data as UserRow) : null;
  }

  async getByUsername(username: string): Promise<User | null> {
    const key = normalizeUsername(username);
    const { data, error } = await this.db
      .from('users')
      .select('*')
      .ilike('username', key)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapUser(data as UserRow) : null;
  }

  async updateUser(id: string, patch: UpdateUserPatch): Promise<User> {
    const row: Record<string, unknown> = { updated_at: now() };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      const col = PATCH_MAP[k];
      if (!col) continue;
      row[col] = k === 'username' && typeof v === 'string' ? normalizeUsername(v) : v;
    }
    const { data, error } = await this.db
      .from('users')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'update user failed');
    return mapUser(data as UserRow);
  }

  async isUsernameAvailable(username: string, excludeUserId?: string): Promise<boolean> {
    const key = normalizeUsername(username);
    await this.deactivateExpiredReservations(key);
    let q = this.db.from('users').select('id').ilike('username', key).is('deleted_at', null);
    if (excludeUserId) q = q.neq('id', excludeUserId);
    const { data, error } = await q.maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return false;
    const reservation = await this.getActiveReservation(key);
    if (reservation && reservation.userId !== excludeUserId) return false;
    return true;
  }

  async insertUsernameReservation(input: {
    username: string;
    userId: string;
    redirectToUsername: string;
    reservedUntil: string;
  }): Promise<UsernameReservation> {
    await this.deactivateExpiredReservations(input.username);
    const { data, error } = await this.db
      .from('username_reservations')
      .insert({
        username: normalizeUsername(input.username),
        user_id: input.userId,
        redirect_to_username: normalizeUsername(input.redirectToUsername),
        reserved_until: input.reservedUntil,
        is_active: true,
      })
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'insert reservation failed');
    return mapReservation(data as UserRow);
  }

  async getActiveReservation(username: string): Promise<UsernameReservation | null> {
    await this.deactivateExpiredReservations(username);
    const key = normalizeUsername(username);
    const { data, error } = await this.db
      .from('username_reservations')
      .select('*')
      .ilike('username', key)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapReservation(data as UserRow) : null;
  }

  async deactivateExpiredReservations(username?: string): Promise<void> {
    let q = this.db
      .from('username_reservations')
      .update({ is_active: false })
      .eq('is_active', true)
      .lte('reserved_until', now());
    if (username) q = q.ilike('username', normalizeUsername(username));
    const { error } = await q;
    if (error) throw new Error(error.message);
  }

  async applyCounters(id: string, counters: Partial<MaterializedUserCounters>): Promise<void> {
    const row: Record<string, unknown> = {
      updated_at: now(),
      counters_updated_at: counters.countersUpdatedAt ?? now(),
    };
    if (counters.followersCount !== undefined) row.followers_count = counters.followersCount;
    if (counters.followingCount !== undefined) row.following_count = counters.followingCount;
    if (counters.collectionCount !== undefined) row.collection_count = counters.collectionCount;
    const { error } = await this.db.from('users').update(row).eq('id', id);
    if (error) throw new Error(error.message);
  }
}
