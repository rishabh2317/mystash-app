import type { User } from '../user/domain/types';
import { isCreator } from '../user/domain/types';
import type { CreatorIndexInput } from './documents';

export function userToCreatorIndexInput(user: User): CreatorIndexInput {
  const eligible =
    user.accountStatus === 'ACTIVE' &&
    isCreator(user) &&
    !user.deletedAt &&
    Boolean(user.username);
  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    bio: user.bio,
    avatarRef: user.profilePhotoUrl,
    followersCount: user.followersCount,
    creatorAuthority: 0,
    searchEligible: eligible,
    contentRevision: user.schemaVersion,
    deleted: Boolean(user.deletedAt) || user.accountStatus === 'DELETED',
  };
}
