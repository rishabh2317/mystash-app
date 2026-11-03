import { Image } from 'expo-image';
import React, { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { PRODUCT_CARD_LAYOUT } from '@/src/ui/productCardLayout';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { outlineCardChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import { CATALOG_IMAGE_PLACEHOLDER } from '@/src/types/catalogProduct';
import type { StashCategoryCardModel } from '@/src/ui/bag';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';

type CategorySummary = Pick<StashCategoryCardModel, 'key' | 'title' | 'count' | 'previewUrls'>;
type Props<T extends CategorySummary> = {
  category: T;
  onPress: (category: T) => void;
  placeholder?: 'product' | 'place';
  /**
   * Optional meta override. When omitted, shows product count only
   * (Stash home). Search maps CreatorProductShelf → this prop at the edge.
   */
  metaLabel?: string;
};

/** Gap between collage thumbnails (card fill shows through). */
const COLLAGE_GUTTER = 3;

/**
 * Editorial category shelf tile for Stash home — thin border, marginal inner
 * padding, 2×2 collage with gutters in the card fill and corner radii matching
 * the tile.
 */
export function StashCategoryCard<T extends CategorySummary>({ category, onPress, metaLabel: metaOverride, placeholder = 'product' }: Props<T>) {
  const { tokens } = useThemeMode();
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const slots = [0, 1, 2, 3].map((index) => category.previewUrls[index] ?? null);
  const countLabel = category.count === 1 ? '1 product' : `${category.count} products`;
  const metaLabel = metaOverride ?? countLabel;
  const inset = PRODUCT_CARD_LAYOUT.relatedInset;
  const collageRadius = tokens.radius.md;
  const innerRadius = Math.max(4, Math.round(collageRadius * 0.55));

  const cellStyle = (index: number) => {
    switch (index) {
      case 0:
        return {
          borderTopLeftRadius: collageRadius,
          borderTopRightRadius: innerRadius,
          borderBottomLeftRadius: innerRadius,
          borderBottomRightRadius: innerRadius,
        };
      case 1:
        return {
          borderTopLeftRadius: innerRadius,
          borderTopRightRadius: collageRadius,
          borderBottomLeftRadius: innerRadius,
          borderBottomRightRadius: innerRadius,
        };
      case 2:
        return {
          borderTopLeftRadius: innerRadius,
          borderTopRightRadius: innerRadius,
          borderBottomLeftRadius: collageRadius,
          borderBottomRightRadius: innerRadius,
        };
      default:
        return {
          borderTopLeftRadius: innerRadius,
          borderTopRightRadius: innerRadius,
          borderBottomLeftRadius: innerRadius,
          borderBottomRightRadius: collageRadius,
        };
    }
  };

  const renderCell = (index: number) => {
    const candidate = slots[index];
    const uri = candidate && !failedImages.includes(candidate) ? candidate : null;
    return (
      <View
        key={`${category.key}-${index}`}
        style={[
          styles.cell,
          {
            backgroundColor: tokens.color.surfaceSubtle,
            ...cellStyle(index),
          },
        ]}
      >
        {!uri && placeholder === 'place' ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons accessible={false} name="location-outline" size={18} color={tokens.color.textMuted} />
          </View>
        ) : <Image
          source={{ uri: uri && uri.startsWith('http') ? uri : CATALOG_IMAGE_PLACEHOLDER }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          {...(placeholder === 'place' ? { accessible: false, cachePolicy: 'memory-disk' as const,
            onError: () => { if (uri) setFailedImages(previous => [...previous, uri]); } } : {})}
        />}
      </View>
    );
  };

  return (
    <Pressable
      onPress={() => onPress(category)}
      accessibilityRole="button"
      accessibilityLabel={`${category.title}, ${metaLabel}`}
      style={({ pressed }) => [
        styles.card,
        {
          ...outlineCardChrome(tokens),
          borderRadius: tokens.radius.lg,
          padding: inset,
          opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
        },
      ]}
    >
      <View
        style={[
          styles.collage,
          {
            backgroundColor: tokens.semantic.surface.outlineCard,
            borderRadius: collageRadius,
            gap: COLLAGE_GUTTER,
          },
        ]}
      >
        <View style={[styles.row, { gap: COLLAGE_GUTTER }]}>
          {renderCell(0)}
          {renderCell(1)}
        </View>
        <View style={[styles.row, { gap: COLLAGE_GUTTER }]}>
          {renderCell(2)}
          {renderCell(3)}
        </View>
      </View>
      <View
        style={[
          styles.meta,
          {
            paddingTop: tokens.space.xs,
            paddingHorizontal: 2,
            gap: 2,
          },
        ]}
      >
        <Text style={typeStyle(tokens, 'tileTitle')} numberOfLines={1}>
          {category.title}
        </Text>
        <Text style={typeStyle(tokens, 'tileMeta')} numberOfLines={1}>
          {metaLabel}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 0,
    borderWidth: StyleSheet.hairlineWidth,
  },
  collage: {
    width: '100%',
    aspectRatio: 1,
    overflow: 'hidden',
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
  },
  cell: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
  },
  meta: {
    minWidth: 0,
  },
});
