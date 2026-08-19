import type { CreatorSnapshot } from '../collection/domain/types';
import { buildUserEventPayload } from './domain/events';
import {
  assertAccountTransition,
  assertCreatorTransition,
} from './domain/lifecycle';
import type {
  MaterializedUserCounters,
  PublicUserProfile,
  User,
  UserSettings,
} from './domain/types';
import {
  USERNAME_RESERVATION_DAYS,
  isCreator,
  toPublicProfile,
  toSettings,
} from './domain/types';
import { emitUserEvent } from './observability';
import { scheduleSearchUserProjection } from '../search/schedule';
import type { CollectionDiscoveryPort, UserCreatorPort } from './ports';
import type { UserRepository } from './UserRepository';

export class UserServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'UserServiceError';
  }
}

export type AuthUserLike = {
  id: string;
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
  user_metadata?: Record<string, unknown> | null;
};

const BIO_MAX = 500;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function sanitizeUsername(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, '')
    .replace(/^\.+|\.+$/g, '');
  if (cleaned.length < 3) {
    throw new UserServiceError('Username must be at least 3 characters', 400);
  }
  if (cleaned.length > 30) {
    throw new UserServiceError('Username must be at most 30 characters', 400);
  }
  return cleaned;
}

function deriveUsername(user: AuthUserLike): string {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const candidate =
    str(meta.preferred_username) ||
    str(meta.user_name) ||
    str(meta.username) ||
    user.email?.split('@')[0] ||
    `user_${user.id.replace(/-/g, '').slice(0, 8)}`;
  try {
    return sanitizeUsername(candidate);
  } catch {
    return sanitizeUsername(`user_${user.id.replace(/-/g, '').slice(0, 10)}`);
  }
}

function deriveDisplayName(user: AuthUserLike, username: string): string {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return str(meta.full_name) || str(meta.name) || username;
}

function derivePhoto(user: AuthUserLike): string | null {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return str(meta.avatar_url) || str(meta.picture);
}

function reservationUntil(from = new Date()): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + USERNAME_RESERVATION_DAYS);
  return d.toISOString();
}

export class UserService implements UserCreatorPort {
  constructor(
    private readonly repo: UserRepository,
    private readonly discovery: CollectionDiscoveryPort = {
      async hideCreatorCollectionsFromDiscovery() {},
      async restoreCreatorCollectionsDiscovery() {},
    },
  ) {}

  async getById(id: string): Promise<User | null> {
    return this.repo.getById(id);
  }

  async getPublicProfile(username: string): Promise<PublicUserProfile | null> {
    const user = await this.repo.getByUsername(username);
    if (!user || user.deletedAt || user.accountStatus === 'DELETED') return null;
    if (user.accountStatus === 'SUSPENDED') return null;
    return toPublicProfile(user);
  }

  async resolveUsernameRedirect(username: string): Promise<string | null> {
    const reservation = await this.repo.getActiveReservation(username);
    return reservation?.redirectToUsername ?? null;
  }

  async getSettings(userId: string): Promise<UserSettings | null> {
    const user = await this.repo.getById(userId);
    if (!user || user.deletedAt) return null;
    return toSettings(user);
  }

  async ensureFromAuth(authUser: AuthUserLike): Promise<User> {
    const existing = await this.repo.getById(authUser.id);
    if (existing) {
      if (authUser.email && authUser.email !== existing.emailMirrored) {
        return this.repo.updateUser(authUser.id, { emailMirrored: authUser.email });
      }
      return existing;
    }

    let username = deriveUsername(authUser);
    if (!(await this.repo.isUsernameAvailable(username))) {
      username = sanitizeUsername(
        `${username.slice(0, 20)}_${authUser.id.replace(/-/g, '').slice(0, 6)}`,
      );
    }

    const provider =
      str((authUser.app_metadata ?? {}).provider) ||
      str((authUser.user_metadata ?? {}).provider) ||
      'email';

    const user = await this.repo.insertUser({
      id: authUser.id,
      authProvider: provider,
      username,
      displayName: deriveDisplayName(authUser, username),
      profilePhotoUrl: derivePhoto(authUser),
      accountStatus: 'ACTIVE',
      creatorStatus: 'NONE',
      emailMirrored: authUser.email ?? null,
    });

    emitUserEvent(
      'UserCreated',
      buildUserEventPayload({
        userId: user.id,
        accountStatus: user.accountStatus,
        creatorStatus: user.creatorStatus,
        username: user.username,
      }),
    );
    return user;
  }

  async updateProfile(
    userId: string,
    patch: {
      displayName?: string | null;
      profilePhotoUrl?: string | null;
      bio?: string | null;
      websiteUrl?: string | null;
      socialLinks?: Record<string, string>;
    },
  ): Promise<User> {
    const user = await this.requireActiveAccount(userId);
    if (patch.bio != null && patch.bio.length > BIO_MAX) {
      throw new UserServiceError(`Bio must be at most ${BIO_MAX} characters`, 400);
    }
    const updated = await this.repo.updateUser(userId, {
      displayName: patch.displayName !== undefined ? patch.displayName : user.displayName,
      profilePhotoUrl:
        patch.profilePhotoUrl !== undefined ? patch.profilePhotoUrl : user.profilePhotoUrl,
      bio: patch.bio !== undefined ? patch.bio : user.bio,
      websiteUrl: patch.websiteUrl !== undefined ? patch.websiteUrl : user.websiteUrl,
      socialLinks: patch.socialLinks !== undefined ? patch.socialLinks : user.socialLinks,
    });
    emitUserEvent(
      'ProfileUpdated',
      buildUserEventPayload({ userId, username: updated.username }),
    );
    scheduleSearchUserProjection(updated);
    return updated;
  }

  async changeUsername(userId: string, nextUsernameRaw: string): Promise<User> {
    const user = await this.requireActiveAccount(userId);
    const nextUsername = sanitizeUsername(nextUsernameRaw);
    if (nextUsername === user.username) return user;
    if (!(await this.repo.isUsernameAvailable(nextUsername, userId))) {
      throw new UserServiceError('Username unavailable', 409);
    }
    await this.repo.insertUsernameReservation({
      username: user.username,
      userId,
      redirectToUsername: nextUsername,
      reservedUntil: reservationUntil(),
    });
    const updated = await this.repo.updateUser(userId, { username: nextUsername });
    emitUserEvent(
      'UsernameChanged',
      buildUserEventPayload({
        userId,
        oldUsername: user.username,
        newUsername: nextUsername,
      }),
    );
    scheduleSearchUserProjection(updated);
    return updated;
  }

  async updateLocale(
    userId: string,
    patch: { country?: string | null; language?: string | null; timezone?: string | null },
  ): Promise<User> {
    await this.requireActiveAccount(userId);
    return this.repo.updateUser(userId, patch);
  }

  async startCreatorOnboarding(userId: string): Promise<User> {
    const user = await this.requireActiveAccount(userId);
    assertCreatorTransition(user.creatorStatus, 'ONBOARDING');
    return this.setCreatorStatus(user, 'ONBOARDING');
  }

  async completeCreatorOnboarding(userId: string): Promise<User> {
    const user = await this.requireActiveAccount(userId);
    assertCreatorTransition(user.creatorStatus, 'ACTIVE');
    return this.setCreatorStatus(user, 'ACTIVE');
  }

  async abandonCreatorOnboarding(userId: string): Promise<User> {
    const user = await this.requireActiveAccount(userId);
    assertCreatorTransition(user.creatorStatus, 'NONE');
    return this.setCreatorStatus(user, 'NONE');
  }

  async suspendCreator(userId: string): Promise<User> {
    const user = await this.requireUser(userId);
    assertCreatorTransition(user.creatorStatus, 'SUSPENDED');
    return this.setCreatorStatus(user, 'SUSPENDED');
  }

  async reinstateCreator(userId: string): Promise<User> {
    const user = await this.requireUser(userId);
    assertCreatorTransition(user.creatorStatus, 'ACTIVE');
    return this.setCreatorStatus(user, 'ACTIVE');
  }

  async suspendAccount(userId: string): Promise<User> {
    const user = await this.requireUser(userId);
    assertAccountTransition(user.accountStatus, 'SUSPENDED');
    const updated = await this.repo.updateUser(userId, { accountStatus: 'SUSPENDED' });
    emitUserEvent(
      'AccountSuspended',
      buildUserEventPayload({
        userId,
        accountStatus: 'SUSPENDED',
        from: user.accountStatus,
        to: 'SUSPENDED',
      }),
    );
    scheduleSearchUserProjection(updated);
    return updated;
  }

  async reinstateAccount(userId: string): Promise<User> {
    const user = await this.requireUser(userId);
    assertAccountTransition(user.accountStatus, 'ACTIVE');
    const updated = await this.repo.updateUser(userId, { accountStatus: 'ACTIVE' });
    emitUserEvent(
      'AccountReinstated',
      buildUserEventPayload({
        userId,
        accountStatus: 'ACTIVE',
        from: user.accountStatus,
        to: 'ACTIVE',
      }),
    );
    scheduleSearchUserProjection(updated);
    return updated;
  }

  async deleteAccount(userId: string): Promise<User> {
    const user = await this.requireUser(userId);
    assertAccountTransition(user.accountStatus, 'DELETED');
    const updated = await this.repo.updateUser(userId, {
      accountStatus: 'DELETED',
      deletedAt: new Date().toISOString(),
      emailMirrored: null,
      displayName: null,
      profilePhotoUrl: null,
      bio: null,
      websiteUrl: null,
      socialLinks: {},
    });
    await this.discovery.hideCreatorCollectionsFromDiscovery(userId);
    emitUserEvent(
      'AccountDeleted',
      buildUserEventPayload({
        userId,
        accountStatus: 'DELETED',
        from: user.accountStatus,
        to: 'DELETED',
      }),
    );
    scheduleSearchUserProjection(updated);
    return updated;
  }

  async restoreAccount(userId: string): Promise<User> {
    const user = await this.requireUser(userId);
    assertAccountTransition(user.accountStatus, 'ACTIVE');
    const updated = await this.repo.updateUser(userId, {
      accountStatus: 'ACTIVE',
      deletedAt: null,
    });
    await this.discovery.restoreCreatorCollectionsDiscovery(userId);
    emitUserEvent(
      'AccountRestored',
      buildUserEventPayload({
        userId,
        accountStatus: 'ACTIVE',
        from: user.accountStatus,
        to: 'ACTIVE',
      }),
    );
    scheduleSearchUserProjection(updated);
    return updated;
  }

  async applyCounters(userId: string, counters: Partial<MaterializedUserCounters>): Promise<void> {
    await this.repo.applyCounters(userId, counters);
  }

  async syncEmailFromAuth(userId: string, email: string | null): Promise<User> {
    await this.requireUser(userId);
    return this.repo.updateUser(userId, { emailMirrored: email });
  }

  /** UserCreatorPort */
  async assertCanCreateCollections(userId: string): Promise<void> {
    const user = await this.repo.getById(userId);
    if (!user || user.deletedAt || user.accountStatus === 'DELETED') {
      throw new UserServiceError('User not found', 404);
    }
    if (user.accountStatus === 'SUSPENDED') {
      throw new UserServiceError('Account suspended', 403);
    }
    if (!isCreator(user)) {
      throw new UserServiceError('Creator status ACTIVE required to create Collections', 403);
    }
  }

  /** UserCreatorPort */
  async getCreatorSnapshot(userId: string): Promise<CreatorSnapshot | null> {
    const user = await this.repo.getById(userId);
    if (!user || user.deletedAt) return null;
    return {
      creatorName: user.displayName,
      creatorUsername: user.username,
      creatorAvatar: user.profilePhotoUrl,
      creatorVerified: false,
      creatorSnapshotUpdatedAt: new Date().toISOString(),
    };
  }

  private async setCreatorStatus(user: User, to: User['creatorStatus']): Promise<User> {
    const updated = await this.repo.updateUser(user.id, { creatorStatus: to });
    emitUserEvent(
      'CreatorStatusChanged',
      buildUserEventPayload({
        userId: user.id,
        creatorStatus: to,
        from: user.creatorStatus,
        to,
      }),
    );
    scheduleSearchUserProjection(updated);
    return updated;
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.repo.getById(userId);
    if (!user) throw new UserServiceError('User not found', 404);
    return user;
  }

  private async requireActiveAccount(userId: string): Promise<User> {
    const user = await this.requireUser(userId);
    if (user.deletedAt || user.accountStatus === 'DELETED') {
      throw new UserServiceError('Account deleted', 410);
    }
    if (user.accountStatus === 'SUSPENDED') {
      throw new UserServiceError('Account suspended', 403);
    }
    return user;
  }
}
