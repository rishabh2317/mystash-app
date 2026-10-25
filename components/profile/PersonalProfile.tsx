import React, { useState } from 'react';
import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { CollectionTileSkeleton } from '@/components/collection/CollectionTileSkeleton';
import { PublicCollectionTile } from '@/components/collection/PublicCollectionTile';
import { SkeletonGrid } from '@/components/status/SkeletonStack';
import { DiscoverCreatorsSection } from '@/components/profile/DiscoverCreatorsSection';
import { ProfileContentTabs } from '@/components/profile/ProfileContentTabs';
import { useThemeMode } from '@/contexts/ThemeContext';
import { useDiscoverCreators } from '@/src/hooks/useDiscoverCreators';
import type { CollectionViewModel } from '@/src/types/collection';
import type { CreatorViewModel } from '@/src/types/creator';
import { resolveListLoadState } from '@/src/ui/contentLoadState';
import {
  PERSONAL_PROFILE_COPY,
  PERSONAL_PROFILE_FLATLIST_KEYS,
  PERSONAL_PROFILE_TABS,
  PROFILE_VIDEO_GRID_ASPECT,
  PROFILE_VIDEO_GRID_COLUMNS,
  PROFILE_VIDEO_GRID_GAP,
  PROFILE_VIDEO_GRID_GUTTER,
  type PersonalProfileTab,
  profileGridCellWidth,
} from '@/src/ui/personalProfile';

import { PersonalCreateCollectionCard } from './PersonalCreateCollectionCard';
import { PersonalProfileHeader } from './PersonalProfileHeader';

type Props = {
  creator: CreatorViewModel;
  collections: CollectionViewModel[];
  saved: CollectionViewModel[];
  collectionsLoading?: boolean;
  savedLoading?: boolean;
  onEditPress: () => void;
  onSharePress: () => void;
  onPressCollection: (collection: CollectionViewModel) => void;
  onPressStat: (id: 'collections' | 'following' | 'followers') => void;
  onCreateCollection: () => void;
};

export function PersonalProfile({
  creator,
  collections,
  saved,
  collectionsLoading,
  savedLoading,
  onEditPress,
  onSharePress,
  onPressCollection,
  onPressStat,
  onCreateCollection,
}: Props) {
  const { tokens } = useThemeMode();
  const { width: screenWidth } = useWindowDimensions();
  const [activeTab, setActiveTab] = useState<PersonalProfileTab>('collections');
  const discover = useDiscoverCreators({
    excludeUserId: creator.userId,
    excludeUsername: creator.username,
  });
  const chromeGutter = tokens.space.md;
  const cellWidth = profileGridCellWidth(
    screenWidth,
    PROFILE_VIDEO_GRID_GUTTER,
    PROFILE_VIDEO_GRID_GAP,
    PROFILE_VIDEO_GRID_COLUMNS,
  );

  const header = (
    <View
      style={{
        gap: tokens.space.md,
        paddingHorizontal: chromeGutter,
        paddingBottom: tokens.space.xs,
      }}
    >
      <PersonalProfileHeader
        creator={creator}
        onEditPress={onEditPress}
        onSharePress={onSharePress}
        onPressStat={onPressStat}
      />
      <DiscoverCreatorsSection items={discover.items} loading={discover.loading} />
      <ProfileContentTabs tabs={PERSONAL_PROFILE_TABS} active={activeTab} onChange={setActiveTab} />
    </View>
  );

  const contentStyle = [
    styles.content,
    { paddingHorizontal: PROFILE_VIDEO_GRID_GUTTER, paddingBottom: tokens.space.xxl },
  ];
  const rowStyle = [
    styles.row,
    { gap: PROFILE_VIDEO_GRID_GAP, marginBottom: PROFILE_VIDEO_GRID_GAP },
  ];

  const empty = (message: string) => (
    <Text
      style={{
        color: tokens.color.textMuted,
        marginTop: tokens.space.lg,
        textAlign: 'center',
        fontSize: tokens.fontSize.body,
        lineHeight: tokens.lineHeight.body,
        paddingHorizontal: chromeGutter,
      }}
    >
      {message}
    </Text>
  );

  const items = activeTab === 'collections' ? collections : saved;
  const loading = activeTab === 'collections' ? collectionsLoading : savedLoading;
  const tabLoad = resolveListLoadState({
    itemCount: items.length,
    fetching: Boolean(loading),
  });

  if (tabLoad === 'skeleton') {
    return (
      <View style={styles.centered}>
        {header}
        <SkeletonGrid columns={PROFILE_VIDEO_GRID_COLUMNS} gap={PROFILE_VIDEO_GRID_GAP}>
          <CollectionTileSkeleton variant="public" aspectRatio={PROFILE_VIDEO_GRID_ASPECT} radius={0} />
          <CollectionTileSkeleton variant="public" aspectRatio={PROFILE_VIDEO_GRID_ASPECT} radius={0} />
          <CollectionTileSkeleton variant="public" aspectRatio={PROFILE_VIDEO_GRID_ASPECT} radius={0} />
          <CollectionTileSkeleton variant="public" aspectRatio={PROFILE_VIDEO_GRID_ASPECT} radius={0} />
          <CollectionTileSkeleton variant="public" aspectRatio={PROFILE_VIDEO_GRID_ASPECT} radius={0} />
          <CollectionTileSkeleton variant="public" aspectRatio={PROFILE_VIDEO_GRID_ASPECT} radius={0} />
        </SkeletonGrid>
      </View>
    );
  }

  return (
    <FlatList
      key={
        activeTab === 'collections'
          ? PERSONAL_PROFILE_FLATLIST_KEYS.collections
          : PERSONAL_PROFILE_FLATLIST_KEYS.saved
      }
      data={items}
      keyExtractor={(item) => item.collectionId}
      numColumns={PROFILE_VIDEO_GRID_COLUMNS}
      columnWrapperStyle={rowStyle}
      contentContainerStyle={contentStyle}
      ListHeaderComponent={header}
      ListEmptyComponent={empty(
        activeTab === 'collections'
          ? PERSONAL_PROFILE_COPY.emptyCollections
          : PERSONAL_PROFILE_COPY.emptySaved,
      )}
      ListFooterComponent={
        activeTab === 'collections' ? (
          <View style={{ marginTop: tokens.space.md, paddingHorizontal: chromeGutter }}>
            <PersonalCreateCollectionCard onPress={onCreateCollection} />
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <View style={{ width: cellWidth }}>
          <PublicCollectionTile
            collection={item}
            aspectRatio={PROFILE_VIDEO_GRID_ASPECT}
            flush
            onPress={onPressCollection}
          />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: {},
  row: {
    alignItems: 'flex-start',
  },
  centered: {
    flex: 1,
  },
});
