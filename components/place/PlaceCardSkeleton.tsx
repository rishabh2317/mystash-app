import React from 'react';
import { StyleSheet, View } from 'react-native';

import { SkeletonBlock } from '@/components/status/SkeletonBlock';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { outlineCardChrome } from '@/src/theme/tokens';

export function PlaceCardSkeleton() {
  const tokens = useThemeTokens();
  return (
    <View
      style={[
        styles.card,
        {
          ...outlineCardChrome(tokens),
          borderRadius: tokens.radius.lg,
        },
      ]}
    >
      <SkeletonBlock
        radius={0}
        style={{ width: '100%', height: undefined, aspectRatio: 16 / 9 }}
      />
      <View style={{ padding: tokens.space.md, gap: tokens.space.sm }}>
        <SkeletonBlock height={18} width="70%" />
        <SkeletonBlock height={13} width="40%" />
        <SkeletonBlock height={13} width="55%" />
        <SkeletonBlock height={36} radius={tokens.radius.md} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
