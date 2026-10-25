import React from 'react';
import { StyleSheet, View } from 'react-native';

import { SkeletonBlock } from '@/components/status/SkeletonBlock';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { outlineCardChrome } from '@/src/theme/tokens';
import type { CollectionTileVariant } from './CollectionTile';

type Props = {
  variant?: CollectionTileVariant;
  aspectRatio?: number;
  radius?: number;
};

export function CollectionTileSkeleton({ variant = 'tile', aspectRatio, radius }: Props) {
  const tokens = useThemeTokens();

  if (variant === 'public' || variant === 'creatorRail') {
    return (
      <SkeletonBlock
        radius={radius ?? tokens.radius.md}
        style={{
          width: '100%',
          height: undefined,
          aspectRatio: aspectRatio ?? 9 / 14,
        }}
      />
    );
  }

  if (variant === 'personal') {
    return (
      <View style={{ gap: 6 }}>
        <SkeletonBlock
          radius={tokens.radius.md}
          style={{ width: '100%', height: undefined, aspectRatio: 1 }}
        />
        <SkeletonBlock height={14} width="80%" />
        <SkeletonBlock height={12} width="45%" />
      </View>
    );
  }

  if (variant === 'reel') {
    return (
      <SkeletonBlock
        radius={tokens.radius.md}
        style={{ width: '100%', height: undefined, aspectRatio: 4 / 5 }}
      />
    );
  }

  return (
    <View
      style={[
        styles.tile,
        {
          ...outlineCardChrome(tokens),
          borderRadius: tokens.radius.md,
        },
      ]}
    >
      <SkeletonBlock radius={0} style={styles.thumb} />
      <View style={{ padding: 10, gap: 6 }}>
        <SkeletonBlock height={14} />
        <SkeletonBlock height={12} width="60%" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    flex: 1,
  },
  thumb: {
    width: '100%',
    height: undefined,
    aspectRatio: 9 / 12,
  },
});
