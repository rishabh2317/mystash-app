import React from 'react';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CollectionViewModel } from '@/src/types/collection';
import { useThemeMode } from '@/contexts/ThemeContext';

type Props = {
  collection: CollectionViewModel;
  /** @deprecated Colors come from ThemeMode tokens. */
  isLight?: boolean;
  onPress: (collection: CollectionViewModel) => void;
};

export function CollectionTile({ collection, onPress }: Props) {
  const { tokens } = useThemeMode();
  const title = collection.title?.trim() || 'Untitled collection';
  const creatorLabel =
    collection.creator.displayName?.trim() ||
    (collection.creator.username ? `@${collection.creator.username}` : 'Creator');
  const views = Math.max(0, Math.floor(collection.counters?.views ?? 0));

  return (
    <Pressable
      onPress={() => onPress(collection)}
      accessibilityRole="button"
      accessibilityLabel={`${title} by ${creatorLabel}, ${views} view${views === 1 ? '' : 's'}`}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: tokens.color.surface,
          borderColor: tokens.color.border,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      <View>
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
              { backgroundColor: tokens.color.canvasEnd },
            ]}
          />
        )}
        <View style={styles.viewsBadge} accessibilityElementsHidden>
          <Ionicons name="eye-outline" size={12} color="#F8FAFC" />
          <Text style={styles.viewsText}>{views}</Text>
        </View>
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: tokens.color.text }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[styles.meta, { color: tokens.color.textMuted }]} numberOfLines={1}>
          {creatorLabel}
        </Text>
        <Text style={[styles.meta, { color: tokens.color.textMuted }]}>
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
  viewsBadge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  viewsText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
  },
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
