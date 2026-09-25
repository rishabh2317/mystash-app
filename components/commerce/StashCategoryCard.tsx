import { Image } from 'expo-image';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { outlineCardChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import { CATALOG_IMAGE_PLACEHOLDER } from '@/src/types/catalogProduct';
import type { StashCategoryCardModel } from '@/src/ui/bag';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';

type Props = {
  category: StashCategoryCardModel;
  onPress: (category: StashCategoryCardModel) => void;
  /**
   * Optional meta override. When omitted, shows product count only
   * (Stash home). Search maps CreatorProductShelf → this prop at the edge.
   */
  metaLabel?: string;
};

/** Transparent margin between collage thumbnails (page canvas shows through). */
const COLLAGE_GUTTER = 3;

/**
 * Editorial category shelf tile for Stash home — thin border, marginal inner
 * padding, 2×2 collage with transparent gutters (page wash shows through) and
 * corner radii matching the tile.
 */
export function StashCategoryCard({ category, onPress, metaLabel: metaOverride }: Props) {
  const { tokens } = useThemeMode();
  const slots = [0, 1, 2, 3].map((index) => category.previewUrls[index] ?? null);
  const countLabel = category.count === 1 ? '1 product' : `${category.count} products`;
  const metaLabel = metaOverride ?? countLabel;
  const inset = 6;
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
    const uri = slots[index];
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
        <Image
          source={{ uri: uri && uri.startsWith('http') ? uri : CATALOG_IMAGE_PLACEHOLDER }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
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
