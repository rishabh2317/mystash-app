import { randomUUID } from 'node:crypto';
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

function now(): string {
  return new Date().toISOString();
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export class InMemoryUserRepository implements UserRepository {
  users = new Map<string, User>();
  reservations: UsernameReservation[] = [];

  async insertUser(input: CreateUserInput): Promise<User> {
    if (this.users.has(input.id)) throw new Error('duplicate user id');
    const username = normalizeUsername(input.username);
    for (const u of this.users.values()) {
      if (!u.deletedAt && normalizeUsername(u.username) === username) {
        throw new Error('duplicate username');
      }
    }
    const ts = now();
    const user: User = {
      id: input.id,
      createdAt: ts,
      updatedAt: ts,
      authProvider: input.authProvider ?? null,
      username,
      displayName: input.displayName ?? null,
      profilePhotoUrl: input.profilePhotoUrl ?? null,
      bio: input.bio ?? null,
      websiteUrl: input.websiteUrl ?? null,
      socialLinks: input.socialLinks ?? {},
      accountStatus: input.accountStatus ?? 'ACTIVE',
      creatorStatus: input.creatorStatus ?? 'NONE',
      accountType: input.accountType ?? 'personal',
      country: input.country ?? null,
      language: input.language ?? null,
      timezone: input.timezone ?? null,
      joinedAt: ts,
      deletedAt: null,
      emailMirrored: input.emailMirrored ?? null,
      followersCount: 0,
      followingCount: 0,
      collectionCount: 0,
      countersUpdatedAt: null,
      schemaVersion: USER_SCHEMA_VERSION,
      extensions: {},
    };
    this.users.set(user.id, user);
    return user;
  }

  async getById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async getByUsername(username: string): Promise<User | null> {
    const key = normalizeUsername(username);
    for (const u of this.users.values()) {
      if (!u.deletedAt && normalizeUsername(u.username) === key) return u;
    }
    return null;
  }

  async updateUser(id: string, patch: UpdateUserPatch): Promise<User> {
    const existing = this.users.get(id);
    if (!existing) throw new Error('not found');
    const updated: User = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      joinedAt: existing.joinedAt,
      username: patch.username ? normalizeUsername(patch.username) : existing.username,
      updatedAt: now(),
    };
    this.users.set(id, updated);
    return updated;
  }

  async isUsernameAvailable(username: string, excludeUserId?: string): Promise<boolean> {
    const key = normalizeUsername(username);
    await this.deactivateExpiredReservations(key);
    for (const u of this.users.values()) {
      if (u.deletedAt) continue;
      if (excludeUserId && u.id === excludeUserId) continue;
      if (normalizeUsername(u.username) === key) return false;
    }
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
    const row: UsernameReservation = {
      id: randomUUID(),
      username: normalizeUsername(input.username),
      userId: input.userId,
      redirectToUsername: normalizeUsername(input.redirectToUsername),
      reservedUntil: input.reservedUntil,
      isActive: true,
      createdAt: now(),
    };
    this.reservations.push(row);
    return row;
  }

  async getActiveReservation(username: string): Promise<UsernameReservation | null> {
    await this.deactivateExpiredReservations(username);
    const key = normalizeUsername(username);
    const active = this.reservations
      .filter((r) => r.isActive && normalizeUsername(r.username) === key)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return active[0] ?? null;
  }

  async deactivateExpiredReservations(username?: string): Promise<void> {
    const ts = Date.now();
    const key = username ? normalizeUsername(username) : null;
    for (const r of this.reservations) {
      if (!r.isActive) continue;
      if (key && normalizeUsername(r.username) !== key) continue;
      if (Date.parse(r.reservedUntil) <= ts) r.isActive = false;
    }
  }

  async applyCounters(id: string, counters: Partial<MaterializedUserCounters>): Promise<void> {
    const existing = this.users.get(id);
    if (!existing) throw new Error('not found');
    this.users.set(id, {
      ...existing,
      followersCount: counters.followersCount ?? existing.followersCount,
      followingCount: counters.followingCount ?? existing.followingCount,
      collectionCount: counters.collectionCount ?? existing.collectionCount,
      countersUpdatedAt: counters.countersUpdatedAt ?? now(),
      updatedAt: now(),
    });
  }
}
