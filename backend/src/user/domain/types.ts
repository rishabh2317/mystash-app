/** User domain types — mirrors USER_DOMAIN_SPEC.md V1. */

export const USER_SCHEMA_VERSION = 1;

export const USERNAME_RESERVATION_DAYS = 90;

export type AccountStatus =
  | 'CREATED'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'DELETED'
  | 'ARCHIVED';

export type CreatorStatus = 'NONE' | 'ONBOARDING' | 'ACTIVE' | 'SUSPENDED';

export type AccountType = 'personal' | 'business';

export type MaterializedUserCounters = {
  followersCount: number;
  followingCount: number;
  collectionCount: number;
  countersUpdatedAt: string | null;
};

export type User = {
  id: string;
  createdAt: string;
  updatedAt: string;
  authProvider: string | null;
  username: string;
  displayName: string | null;
  profilePhotoUrl: string | null;
  bio: string | null;
  websiteUrl: string | null;
  socialLinks: Record<string, string>;
  accountStatus: AccountStatus;
  creatorStatus: CreatorStatus;
  accountType: AccountType;
  country: string | null;
  language: string | null;
  timezone: string | null;
  joinedAt: string;
  deletedAt: string | null;
  emailMirrored: string | null;
  followersCount: number;
  followingCount: number;
  collectionCount: number;
  countersUpdatedAt: string | null;
  schemaVersion: number;
  extensions: Record<string, unknown>;
};

/** Computed convenience — never stored as domain SoT. */
export function isCreator(user: Pick<User, 'creatorStatus'>): boolean {
  return user.creatorStatus === 'ACTIVE';
}

export type PublicUserProfile = {
  id: string;
  username: string;
  displayName: string | null;
  profilePhotoUrl: string | null;
  bio: string | null;
  websiteUrl: string | null;
  socialLinks: Record<string, string>;
  creatorStatus: CreatorStatus;
  isCreator: boolean;
  accountType: AccountType;
  joinedAt: string;
  publicStats: {
    followersCount: number;
    followingCount: number;
    collectionCount: number;
    /** Sum of saves_count across published+public+clear Collections. */
    savesCount: number;
  };
};

export type UserSettings = PublicUserProfile & {
  emailMirrored: string | null;
  accountStatus: AccountStatus;
  country: string | null;
  language: string | null;
  timezone: string | null;
  authProvider: string | null;
};

export type UsernameReservation = {
  id: string;
  username: string;
  userId: string;
  redirectToUsername: string;
  reservedUntil: string;
  isActive: boolean;
  createdAt: string;
};

export function toPublicProfile(user: User): PublicUserProfile {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    profilePhotoUrl: user.profilePhotoUrl,
    bio: user.bio,
    websiteUrl: user.websiteUrl,
    socialLinks: user.socialLinks,
    creatorStatus: user.creatorStatus,
    isCreator: isCreator(user),
    accountType: user.accountType,
    joinedAt: user.joinedAt,
    publicStats: {
      followersCount: user.followersCount,
      followingCount: user.followingCount,
      collectionCount: user.collectionCount,
      savesCount: 0,
    },
  };
}

export function toSettings(user: User): UserSettings {
  return {
    ...toPublicProfile(user),
    emailMirrored: user.emailMirrored,
    accountStatus: user.accountStatus,
    country: user.country,
    language: user.language,
    timezone: user.timezone,
    authProvider: user.authProvider,
  };
}
