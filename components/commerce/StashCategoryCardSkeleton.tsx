import React from 'react';
import { StyleSheet, View } from 'react-native';

import { SkeletonBlock } from '@/components/status/SkeletonBlock';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { outlineCardChrome } from '@/src/theme/tokens';

const COLLAGE_GUTTER = 3;
const INSET = 6;

export function StashCategoryCardSkeleton() {
  const tokens = useThemeTokens();
  const collageRadius = tokens.radius.md;
  const innerRadius = Math.max(4, Math.round(collageRadius * 0.55));

  return (
    <View
      style={[
        styles.card,
        {
          ...outlineCardChrome(tokens),
          borderRadius: tokens.radius.lg,
          padding: INSET,
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
          <SkeletonBlock radius={collageRadius} style={[styles.cell, { borderTopLeftRadius: collageRadius, borderTopRightRadius: innerRadius, borderBottomLeftRadius: innerRadius, borderBottomRightRadius: innerRadius }]} />
          <SkeletonBlock radius={innerRadius} style={styles.cell} />
        </View>
        <View style={[styles.row, { gap: COLLAGE_GUTTER }]}>
          <SkeletonBlock radius={innerRadius} style={styles.cell} />
          <SkeletonBlock radius={collageRadius} style={[styles.cell, { borderBottomRightRadius: collageRadius }]} />
        </View>
      </View>
      <View style={{ paddingTop: tokens.space.xs, paddingHorizontal: 2, gap: 2 }}>
        <SkeletonBlock height={16} width="70%" />
        <SkeletonBlock height={12} width="40%" />
      </View>
    </View>
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
    height: undefined,
  },
});
