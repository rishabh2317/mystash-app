import React from 'react';
import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { CollectionTile, type CollectionTileVariant } from '@/components/collection/CollectionTile';
import { CollectionTileSkeleton } from '@/components/collection/CollectionTileSkeleton';
import { SkeletonGrid } from '@/components/status/SkeletonStack';
import { useThemeMode } from '@/contexts/ThemeContext';
import type { CollectionViewModel } from '@/src/types/collection';
import { resolveListLoadState } from '@/src/ui/contentLoadState';
import {
  PROFILE_VIDEO_GRID_COLUMNS,
  PROFILE_VIDEO_GRID_GAP,
  PROFILE_VIDEO_GRID_GUTTER,
  profileGridCellWidth,
} from '@/src/ui/personalProfile';

type Props = {
  items: CollectionViewModel[];
  loading?: boolean;
  error?: string | null;
  empty: string;
  variant: CollectionTileVariant;
  onPress: (collection: CollectionViewModel) => void;
  onEndReached?: () => void;
  loadingMore?: boolean;
};

export function PersonalCollectionList({
  items,
  loading,
  error,
  empty,
  variant,
  onPress,
  onEndReached,
  loadingMore,
}: Props) {
  const { tokens } = useThemeMode();
  const { width: screenWidth } = useWindowDimensions();
  const cellWidth = profileGridCellWidth(
    screenWidth,
    PROFILE_VIDEO_GRID_GUTTER,
    PROFILE_VIDEO_GRID_GAP,
    PROFILE_VIDEO_GRID_COLUMNS,
  );
  const loadState = resolveListLoadState({
    itemCount: items.length,
    fetching: Boolean(loading),
    fetchingMore: loadingMore,
    error: Boolean(error),
  });

  if (loadState === 'skeleton') {
    return (
      <View>
        <SkeletonGrid columns={PROFILE_VIDEO_GRID_COLUMNS} gap={PROFILE_VIDEO_GRID_GAP}>
          <CollectionTileSkeleton variant={variant} />
          <CollectionTileSkeleton variant={variant} />
          <CollectionTileSkeleton variant={variant} />
          <CollectionTileSkeleton variant={variant} />
          <CollectionTileSkeleton variant={variant} />
          <CollectionTileSkeleton variant={variant} />
        </SkeletonGrid>
      </View>
    );
  }

  if (error && items.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={{ color: tokens.color.textMuted, textAlign: 'center' }}>{error}</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.collectionId}
      numColumns={PROFILE_VIDEO_GRID_COLUMNS}
      columnWrapperStyle={{ gap: PROFILE_VIDEO_GRID_GAP, marginBottom: PROFILE_VIDEO_GRID_GAP }}
      contentContainerStyle={{
        paddingHorizontal: PROFILE_VIDEO_GRID_GUTTER,
        paddingBottom: tokens.space.xxl,
      }}
      ListEmptyComponent={
        <Text style={{ color: tokens.color.textMuted, textAlign: 'center', marginTop: tokens.space.lg }}>
          {empty}
        </Text>
      }
      ListFooterComponent={
        loadState === 'contentPaginating' ? (
          <View style={{ marginVertical: 16 }}>
            <SkeletonGrid columns={PROFILE_VIDEO_GRID_COLUMNS} gap={PROFILE_VIDEO_GRID_GAP}>
              <CollectionTileSkeleton variant={variant} />
              <CollectionTileSkeleton variant={variant} />
              <CollectionTileSkeleton variant={variant} />
            </SkeletonGrid>
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <View style={{ width: cellWidth }}>
          <CollectionTile collection={item} variant={variant} onPress={onPress} />
        </View>
      )}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.4}
    />
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
});
