import React from 'react';
import { StyleSheet, View } from 'react-native';

import { SkeletonBlock } from '@/components/status/SkeletonBlock';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { outlineCardChrome } from '@/src/theme/tokens';

import { PRODUCT_CARD_LAYOUT, type ProductCardVariant } from './ProductCard';

type Props = {
  variant?: ProductCardVariant;
};

export function ProductCardSkeleton({ variant = 'standard' }: Props) {
  const tokens = useThemeTokens();

  if (variant === 'collection') {
    return (
      <View
        style={[
          styles.collectionCard,
          {
            ...outlineCardChrome(tokens),
            borderRadius: tokens.radius.lg,
            padding: tokens.space.sm,
            gap: tokens.space.sm,
          },
        ]}
      >
        <View style={[styles.row, { gap: tokens.space.sm }]}>
          <SkeletonBlock
            width={PRODUCT_CARD_LAYOUT.collectionThumbSize}
            height={PRODUCT_CARD_LAYOUT.collectionThumbSize}
            radius={tokens.radius.md}
          />
          <View style={[styles.body, { gap: tokens.space.xxs }]}>
            <SkeletonBlock width="40%" height={12} />
            <SkeletonBlock width="90%" height={16} />
            <SkeletonBlock width="70%" height={16} />
          </View>
        </View>
        <SkeletonBlock height={14} width="35%" />
        <SkeletonBlock height={18} />
        <SkeletonBlock height={18} />
      </View>
    );
  }

  if (variant === 'related' || variant === 'mini') {
    const aspect =
      variant === 'mini'
        ? PRODUCT_CARD_LAYOUT.miniMediaAspect
        : PRODUCT_CARD_LAYOUT.relatedMediaAspect;
    return (
      <View
        style={[
          styles.relatedCard,
          {
            ...outlineCardChrome(tokens),
            borderRadius: tokens.radius.lg,
            overflow: 'hidden',
          },
        ]}
      >
        <SkeletonBlock radius={0} style={{ width: '100%', aspectRatio: aspect, height: undefined }} />
        {variant === 'related' ? (
          <View style={{ padding: tokens.space.xs, gap: tokens.space.xxs }}>
            <SkeletonBlock width="50%" height={11} />
            <SkeletonBlock height={14} />
            <SkeletonBlock width="40%" height={13} />
          </View>
        ) : (
          <View style={{ padding: tokens.space.xs }}>
            <SkeletonBlock height={14} />
          </View>
        )}
      </View>
    );
  }

  if (variant === 'publicProfile') {
    return (
      <SkeletonBlock radius={tokens.radius.md} style={styles.publicPortrait} />
    );
  }

  const thumb =
    variant === 'compact'
      ? PRODUCT_CARD_LAYOUT.compactThumb
      : PRODUCT_CARD_LAYOUT.standardThumb;
  return (
    <View
      style={[
        styles.card,
        {
          ...outlineCardChrome(tokens),
          padding: variant === 'compact' ? 8 : 10,
          gap: variant === 'compact' ? 8 : 10,
        },
      ]}
    >
      <View style={[styles.row, { gap: 12 }]}>
        <SkeletonBlock width={thumb} height={thumb} radius={variant === 'compact' ? 8 : 10} />
        <View style={[styles.body, { gap: 6 }]}>
          <SkeletonBlock width="40%" height={12} />
          <SkeletonBlock height={16} />
          <SkeletonBlock width="55%" height={14} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  body: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  collectionCard: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  relatedCard: {
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
  },
  publicPortrait: {
    width: '100%',
    aspectRatio: 1,
    height: undefined,
  },
});
