import type { CollectionViewModel } from '@/src/types/collection';

/** Personal Profile landing — shopping + curation home, not a public storefront. */
export const PERSONAL_PROFILE_COPY = {
  collections: 'My collections',
  reels: 'My reels',
  saved: 'Saved collections',
  viewAll: 'View all',
  editProfile: 'Edit profile',
  createTitle: 'Create a collection',
  createSubtitle: "Curate products. Share what's worth it.",
  createAction: 'Create',
  emptyCollections: 'No collections yet',
  emptyReels: 'No reels yet',
  emptySaved: 'Nothing saved yet',
  emptyFollowing: 'Not following anyone yet',
  emptyFollowers: 'No followers yet',
  followingUnavailable:
    'Following list details aren’t available yet. The count above is from your profile.',
  followersUnavailable:
    'Follower list details aren’t available yet. The count above is from your profile.',
  collectionsLabel: 'Collections',
  savedLabel: 'Saved',
  followingLabel: 'Following',
  followersLabel: 'Followers',
} as const;

export const PERSONAL_PROFILE_TABS = [
  { id: 'collections', label: 'Collections' },
  { id: 'saved', label: 'Saved' },
] as const;

export type PersonalProfileTab = (typeof PERSONAL_PROFILE_TABS)[number]['id'];

export const PERSONAL_PROFILE_FLATLIST_KEYS = {
  collections: 'personal-profile-collections',
  saved: 'personal-profile-saved',
} as const;

export const PERSONAL_RAIL_PREVIEW = 8;

export type PersonalStatId = 'collections' | 'likes' | 'following' | 'followers';

export type PersonalStat = {
  id: PersonalStatId;
  value: number;
  label: string;
  icon: 'folder-outline' | 'heart-outline' | 'people-outline' | 'person-outline';
};

/** No recently-viewed or saved-product APIs exist — do not render those rails. */
export const PERSONAL_HAS_RECENTLY_VIEWED = false;
export const PERSONAL_HAS_SAVED_PRODUCTS = false;

export function personalRailPreview<T>(
  items: T[],
  limit = PERSONAL_RAIL_PREVIEW,
): T[] {
  return items.slice(0, limit);
}

/** Rails always expose View all — the list screens are real destinations. */
export function shouldShowPersonalViewAll(_total?: number): boolean {
  return true;
}

export function personalStats(input: {
  collectionCount: number;
  totalReelLikesReceived: number;
  followingCount: number;
  followersCount: number;
}): PersonalStat[] {
  return [
    {
      id: 'collections',
      value: Math.max(0, Math.floor(input.collectionCount)),
      label: PERSONAL_PROFILE_COPY.collectionsLabel,
      icon: 'folder-outline',
    },
    {
      id: 'likes',
      value: Math.max(0, Math.floor(input.totalReelLikesReceived)),
      label: 'Likes',
      icon: 'heart-outline',
    },
    {
      id: 'following',
      value: Math.max(0, Math.floor(input.followingCount)),
      label: PERSONAL_PROFILE_COPY.followingLabel,
      icon: 'people-outline',
    },
    {
      id: 'followers',
      value: Math.max(0, Math.floor(input.followersCount)),
      label: PERSONAL_PROFILE_COPY.followersLabel,
      icon: 'person-outline',
    },
  ];
}

export function personalCollectionTitle(collection: CollectionViewModel): string {
  return collection.title?.trim() || 'Untitled collection';
}

export function personalProductCountLabel(count: number): string {
  const n = Math.max(0, Math.floor(count));
  return `${n} product${n === 1 ? '' : 's'}`;
}
