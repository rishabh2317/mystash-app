export type CreatorStatus = 'NONE' | 'ONBOARDING' | 'ACTIVE' | 'SUSPENDED';

export type CreatorViewModel = {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  websiteUrl: string | null;
  socialLinks: Record<string, string>;
  creatorStatus: CreatorStatus;
  isCreator: boolean;
  accountType: 'personal' | 'business' | string;
  joinedAt: string;
  followersCount: number;
  followingCount: number;
  collectionCount: number;
  /** Engagement-owned; omit / false when logged out. */
  isFollowing?: boolean;
};
