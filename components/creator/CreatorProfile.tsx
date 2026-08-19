import React from 'react';
import { View } from 'react-native';
import type { CreatorViewModel } from '@/src/types/creator';
import type { CollectionViewModel } from '@/src/types/collection';
import { CreatorProfileHeader } from './CreatorProfileHeader';
import { CreatorCollectionList } from './CreatorCollectionList';

type Props = {
  creator: CreatorViewModel;
  collections: CollectionViewModel[];
  isLight: boolean;
  isSelf: boolean;
  followPending?: boolean;
  collectionsLoading?: boolean;
  collectionsLoadingMore?: boolean;
  collectionsError?: string | null;
  onFollowPress: () => void;
  onPressCollection: (collection: CollectionViewModel) => void;
  onEndReachedCollections?: () => void;
  onRetryCollections?: () => void;
};

/**
 * Presentation composition for public Creator Profile.
 * No auth / API calls — parents own orchestration.
 */
export function CreatorProfile({
  creator,
  collections,
  isLight,
  isSelf,
  followPending,
  collectionsLoading,
  collectionsLoadingMore,
  collectionsError,
  onFollowPress,
  onPressCollection,
  onEndReachedCollections,
  onRetryCollections,
}: Props) {
  return (
    <View style={{ flex: 1 }}>
      <CreatorCollectionList
        collections={collections}
        isLight={isLight}
        loading={collectionsLoading}
        loadingMore={collectionsLoadingMore}
        error={collectionsError}
        onPressCollection={onPressCollection}
        onEndReached={onEndReachedCollections}
        onRetry={onRetryCollections}
        ListHeaderComponent={
          <CreatorProfileHeader
            creator={creator}
            isLight={isLight}
            isSelf={isSelf}
            followPending={followPending}
            onFollowPress={onFollowPress}
          />
        }
      />
    </View>
  );
}
