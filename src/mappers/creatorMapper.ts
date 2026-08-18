import type { CreatorStatus, CreatorViewModel } from '@/src/types/creator';

type PublicUserProfileDto = {
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
  };
};

export function mapPublicUserToCreatorViewModel(
  user: PublicUserProfileDto,
  opts?: { isFollowing?: boolean },
): CreatorViewModel {
  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.profilePhotoUrl,
    bio: user.bio,
    websiteUrl: user.websiteUrl,
    socialLinks: user.socialLinks ?? {},
    creatorStatus: user.creatorStatus,
    isCreator: user.isCreator,
    accountType: user.accountType,
    joinedAt: user.joinedAt,
    followersCount: user.publicStats?.followersCount ?? 0,
    followingCount: user.publicStats?.followingCount ?? 0,
    collectionCount: user.publicStats?.collectionCount ?? 0,
    isFollowing: opts?.isFollowing,
  };
}
