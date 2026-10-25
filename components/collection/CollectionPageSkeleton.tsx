import React from 'react';
import { View } from 'react-native';

import { ProductCardSkeleton } from '@/components/commerce/ProductCardSkeleton';
import { CollectionTileSkeleton } from '@/components/collection/CollectionTileSkeleton';
import { SkeletonBlock } from '@/components/status/SkeletonBlock';
import { SkeletonStack } from '@/components/status/SkeletonStack';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { COLLECTION_SCROLL_HORIZONTAL_PADDING } from '@/src/ui/collectionLayout';

export function CollectionPageSkeleton() {
  const tokens = useThemeTokens();
  const pad = COLLECTION_SCROLL_HORIZONTAL_PADDING;
  return (
    <SkeletonStack
      gap={tokens.space.lg}
      style={{ paddingHorizontal: pad, paddingTop: tokens.space.xs, paddingBottom: tokens.space.xxl }}
    >
      <View style={{ gap: tokens.space.sm }}>
        <SkeletonBlock height={28} width="75%" />
        <SkeletonBlock height={14} />
        <SkeletonBlock height={14} width="55%" />
      </View>
      <SkeletonBlock
        radius={tokens.radius.lg}
        style={{ width: '100%', height: undefined, aspectRatio: 16 / 9 }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm }}>
        <SkeletonBlock width={36} height={36} radius={18} />
        <SkeletonBlock height={14} width="40%" />
      </View>
      <ProductCardSkeleton variant="collection" />
      <ProductCardSkeleton variant="collection" />
      <View style={{ flexDirection: 'row', gap: tokens.space.sm }}>
        <View style={{ flex: 1 }}>
          <CollectionTileSkeleton variant="public" />
        </View>
        <View style={{ flex: 1 }}>
          <CollectionTileSkeleton variant="public" />
        </View>
      </View>
    </SkeletonStack>
  );
}
