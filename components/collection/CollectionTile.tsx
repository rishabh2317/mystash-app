import React from 'react';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CollectionViewModel } from '@/src/types/collection';

type Props = {
  collection: CollectionViewModel;
  isLight: boolean;
  onPress: (collection: CollectionViewModel) => void;
};

export function CollectionTile({ collection, isLight, onPress }: Props) {
  const title = collection.title?.trim() || 'Untitled collection';
  const creatorLabel =
    collection.creator.displayName?.trim() ||
    (collection.creator.username ? `@${collection.creator.username}` : 'Creator');

  return (
    <Pressable
      onPress={() => onPress(collection)}
      accessibilityRole="button"
      accessibilityLabel={`${title} by ${creatorLabel}`}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: isLight ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.06)',
          borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)',
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      {collection.heroThumbnailUrl ? (
        <Image
          source={{ uri: collection.heroThumbnailUrl }}
          style={styles.thumb}
          contentFit="cover"
        />
      ) : (
        <View
          style={[
            styles.thumb,
            styles.thumbFallback,
            { backgroundColor: isLight ? '#E5E7EB' : '#1E293B' },
          ]}
        />
      )}
      <View style={styles.body}>
        <Text style={[styles.title, { color: isLight ? '#1A1A1B' : '#F8FAFC' }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[styles.meta, { color: isLight ? '#6B7280' : '#94A3B8' }]} numberOfLines={1}>
          {creatorLabel}
        </Text>
        <Text style={[styles.meta, { color: isLight ? '#4E5257' : '#AEB8C5' }]}>
          {collection.productCount} product{collection.productCount === 1 ? '' : 's'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    flex: 1,
  },
  thumb: {
    width: '100%',
    aspectRatio: 9 / 12,
    backgroundColor: '#111',
  },
  thumbFallback: {},
  body: {
    padding: 10,
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  meta: {
    fontSize: 12,
  },
});
