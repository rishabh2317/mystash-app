import React from 'react';
import { StyleSheet, View } from 'react-native';

import { SkeletonBlock } from '@/components/status/SkeletonBlock';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { outlineCardChrome } from '@/src/theme/tokens';
import { PRODUCT_CARD_LAYOUT } from '@/src/ui/productCardLayout';
import { FEED_MIN_HIT_TARGET } from '@/src/ui/feedA11y';

export function PlaceCardSkeleton() {
  const tokens = useThemeTokens();
  return <View style={[styles.card, outlineCardChrome(tokens), {
    borderRadius: tokens.radius.lg, padding: PRODUCT_CARD_LAYOUT.relatedInset,
  }]}>
    <SkeletonBlock radius={tokens.radius.md} style={{ width: '100%', height: undefined, aspectRatio: PRODUCT_CARD_LAYOUT.relatedMediaAspect }} />
    <View style={{ paddingTop: tokens.space.xs, gap: tokens.space.xxs }}>
      <SkeletonBlock height={tokens.lineHeight.caption} width="85%" />
      <SkeletonBlock height={tokens.lineHeight.micro} width="65%" />
      <View style={{ minHeight: FEED_MIN_HIT_TARGET, justifyContent: 'center' }}>
        <SkeletonBlock height={tokens.lineHeight.micro} width="48%" />
      </View>
    </View>
  </View>;
}
const styles = StyleSheet.create({ card: { width: '100%', borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' } });
