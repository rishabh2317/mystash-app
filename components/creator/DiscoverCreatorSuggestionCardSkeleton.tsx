import React from 'react';
import { StyleSheet, View } from 'react-native';

import { SkeletonBlock } from '@/components/status/SkeletonBlock';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { outlineCardChrome } from '@/src/theme/tokens';

type Props = {
  variant?: 'compact' | 'detail';
};

export function DiscoverCreatorSuggestionCardSkeleton({ variant = 'detail' }: Props) {
  const tokens = useThemeTokens();

  if (variant === 'compact') {
    return (
      <View
        style={[
          styles.compactCard,
          {
            ...outlineCardChrome(tokens),
            borderRadius: tokens.radius.md,
          },
        ]}
      >
        <SkeletonBlock width={56} height={56} radius={28} />
        <SkeletonBlock height={14} width="70%" />
        <SkeletonBlock height={12} width="85%" />
        <SkeletonBlock height={28} radius={tokens.radius.pill} />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.detailCard,
        {
          ...outlineCardChrome(tokens),
          borderRadius: tokens.radius.md,
        },
      ]}
    >
      <View style={[styles.detailHeader, { gap: tokens.space.sm }]}>
        <SkeletonBlock width={56} height={56} radius={28} />
        <View style={styles.detailIdentity}>
          <SkeletonBlock height={16} width="50%" />
          <SkeletonBlock height={12} width="40%" />
        </View>
        <SkeletonBlock width={72} height={28} radius={tokens.radius.pill} />
      </View>
      <View style={[styles.mediaRow, { gap: tokens.space.xxs }]}>
        <SkeletonBlock radius={tokens.radius.sm} style={styles.mediaCell} />
        <SkeletonBlock radius={tokens.radius.sm} style={styles.mediaCell} />
        <SkeletonBlock radius={tokens.radius.sm} style={styles.mediaCell} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  compactCard: {
    width: 132,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingTop: 12,
    paddingBottom: 10,
    alignItems: 'center',
    gap: 6,
  },
  detailCard: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 10,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailIdentity: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  mediaRow: {
    flexDirection: 'row',
  },
  mediaCell: {
    flex: 1,
    aspectRatio: 1,
    height: undefined,
  },
});
