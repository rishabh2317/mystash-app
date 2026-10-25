import React from 'react';
import { StyleSheet, View } from 'react-native';

import { SkeletonBlock } from '@/components/status/SkeletonBlock';
import { SkeletonStack } from '@/components/status/SkeletonStack';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { outlineCardChrome } from '@/src/theme/tokens';

const IDENTITY_IMAGE = 128;
const GUTTER = 16;

export function ProductPageSkeleton() {
  const tokens = useThemeTokens();
  return (
    <SkeletonStack
      gap={tokens.space.xl}
      style={{
        paddingHorizontal: GUTTER,
        paddingTop: tokens.space.md,
        paddingBottom: tokens.space.xxl,
      }}
    >
      <View style={[styles.identity, { gap: tokens.space.md }]}>
        <View
          style={[
            styles.identityImageWrap,
            {
              padding: 4,
              borderRadius: tokens.radius.lg,
              ...outlineCardChrome(tokens),
            },
          ]}
        >
          <SkeletonBlock width={IDENTITY_IMAGE} height={IDENTITY_IMAGE} radius={tokens.radius.md} />
        </View>
        <View style={[styles.identityCopy, { gap: tokens.space.xs }]}>
          <SkeletonBlock height={12} width="35%" />
          <SkeletonBlock height={22} />
          <SkeletonBlock height={22} width="80%" />
          <SkeletonBlock height={16} width="40%" />
        </View>
      </View>
      <View style={{ gap: tokens.space.sm }}>
        <SkeletonBlock height={16} width="45%" />
        <OfferRowSkeleton />
        <OfferRowSkeleton />
        <OfferRowSkeleton />
      </View>
    </SkeletonStack>
  );
}

function OfferRowSkeleton() {
  const tokens = useThemeTokens();
  return (
    <View
      style={[
        styles.offer,
        {
          ...outlineCardChrome(tokens),
          borderRadius: tokens.radius.lg,
          padding: tokens.space.md,
          gap: tokens.space.xs,
        },
      ]}
    >
      <SkeletonBlock height={14} width="40%" />
      <SkeletonBlock height={18} width="30%" />
      <SkeletonBlock height={36} radius={tokens.radius.md} />
    </View>
  );
}

const styles = StyleSheet.create({
  identity: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  identityImageWrap: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
    paddingTop: 4,
  },
  offer: {
    borderWidth: StyleSheet.hairlineWidth,
  },
});
