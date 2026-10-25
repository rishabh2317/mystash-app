import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import type { CollectionViewModel } from '@/src/types/collection';
import { CollectionTile } from '@/components/collection/CollectionTile';
import {
  PROFILE_VIDEO_GRID_COLUMNS,
  PROFILE_VIDEO_GRID_GAP,
  PROFILE_VIDEO_GRID_GUTTER,
  profileGridCellWidth,
} from '@/src/ui/personalProfile';

type Props = {
  collections: CollectionViewModel[];
  isLight: boolean;
  loading?: boolean;
  loadingMore?: boolean;
  error?: string | null;
  emptyMessage?: string;
  onPressCollection: (collection: CollectionViewModel) => void;
  onEndReached?: () => void;
  onRetry?: () => void;
  ListHeaderComponent?: React.ReactElement | null;
};

export function CreatorCollectionList({
  collections,
  isLight,
  loading,
  loadingMore,
  error,
  emptyMessage = 'No collections yet',
  onPressCollection,
  onEndReached,
  onRetry,
  ListHeaderComponent,
}: Props) {
  const muted = isLight ? '#4E5257' : '#AEB8C5';
  const text = isLight ? '#1A1A1B' : '#F8FAFC';
  const { width: screenWidth } = useWindowDimensions();
  const cellWidth = profileGridCellWidth(
    screenWidth,
    PROFILE_VIDEO_GRID_GUTTER,
    PROFILE_VIDEO_GRID_GAP,
    PROFILE_VIDEO_GRID_COLUMNS,
  );

  if (loading && collections.length === 0) {
    return (
      <View style={styles.centered}>
        {ListHeaderComponent}
        <ActivityIndicator style={{ marginTop: 24 }} color={text} />
      </View>
    );
  }

  if (error && collections.length === 0) {
    return (
      <View style={styles.centered}>
        {ListHeaderComponent}
        <Text style={[styles.message, { color: muted }]}>{error}</Text>
        {onRetry ? (
          <Pressable onPress={onRetry} style={styles.retry}>
            <Text style={{ color: text, fontWeight: '700' }}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <FlatList
      data={collections}
      keyExtractor={(item) => item.collectionId}
      numColumns={PROFILE_VIDEO_GRID_COLUMNS}
      columnWrapperStyle={styles.row}
      contentContainerStyle={styles.content}
      ListHeaderComponent={ListHeaderComponent}
      ListEmptyComponent={
        <Text style={[styles.message, { color: muted, marginTop: 24 }]}>{emptyMessage}</Text>
      }
      ListFooterComponent={
        loadingMore ? <ActivityIndicator style={{ marginVertical: 16 }} color={text} /> : null
      }
      renderItem={({ item }) => (
        <View style={{ width: cellWidth }}>
          <CollectionTile collection={item} isLight={isLight} onPress={onPressCollection} />
        </View>
      )}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.4}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: PROFILE_VIDEO_GRID_GUTTER,
    paddingBottom: 40,
  },
  row: {
    gap: PROFILE_VIDEO_GRID_GAP,
    marginBottom: PROFILE_VIDEO_GRID_GAP,
  },
  centered: {
    flex: 1,
    paddingHorizontal: 20,
  },
  message: {
    textAlign: 'center',
    fontSize: 14,
    marginTop: 12,
  },
  retry: {
    alignSelf: 'center',
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
});
