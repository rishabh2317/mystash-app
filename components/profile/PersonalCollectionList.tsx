import React from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { CollectionTile, type CollectionTileVariant } from '@/components/collection/CollectionTile';
import { useThemeMode } from '@/contexts/ThemeContext';
import type { CollectionViewModel } from '@/src/types/collection';

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

  if (loading && items.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={tokens.color.text} />
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
      numColumns={2}
      columnWrapperStyle={{ gap: tokens.space.sm }}
      contentContainerStyle={{
        padding: tokens.space.md,
        paddingBottom: tokens.space.xxl,
        gap: tokens.space.sm,
      }}
      ListEmptyComponent={
        <Text style={{ color: tokens.color.textMuted, textAlign: 'center', marginTop: tokens.space.lg }}>
          {empty}
        </Text>
      }
      ListFooterComponent={
        loadingMore ? <ActivityIndicator color={tokens.color.text} style={{ marginVertical: 16 }} /> : null
      }
      renderItem={({ item }) => (
        <View style={styles.cell}>
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
  cell: {
    flex: 1,
  },
});
