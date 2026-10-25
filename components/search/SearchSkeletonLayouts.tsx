import React from 'react';
import { View } from 'react-native';

import { CollectionTileSkeleton } from '@/components/collection/CollectionTileSkeleton';
import { ProductCardSkeleton } from '@/components/commerce/ProductCardSkeleton';
import { StashCategoryCardSkeleton } from '@/components/commerce/StashCategoryCardSkeleton';
import { CreatorCardSkeleton } from '@/components/creator/CreatorCardSkeleton';
import { SkeletonBlock } from '@/components/status/SkeletonBlock';
import { SkeletonGrid, SkeletonStack } from '@/components/status/SkeletonStack';
import { useThemeTokens } from '@/src/theme/useThemeTokens';

export function SearchDiscoverSkeleton() {
  const tokens = useThemeTokens();
  return (
    <SkeletonStack gap={tokens.space.xl}>
      <View style={{ gap: tokens.space.sm }}>
        <SkeletonBlock height={16} width={100} />
        <View style={{ flexDirection: 'row', gap: tokens.space.sm }}>
          <View style={{ width: 132 }}>
            <CollectionTileSkeleton variant="public" />
          </View>
          <View style={{ width: 132 }}>
            <CollectionTileSkeleton variant="public" />
          </View>
          <View style={{ width: 132 }}>
            <CollectionTileSkeleton variant="public" />
          </View>
        </View>
      </View>
      <View style={{ gap: tokens.space.sm }}>
        <SkeletonBlock height={16} width={140} />
        <SkeletonGrid columns={2} gap={12}>
          <StashCategoryCardSkeleton />
          <StashCategoryCardSkeleton />
        </SkeletonGrid>
      </View>
      <View style={{ gap: tokens.space.sm }}>
        <SkeletonBlock height={16} width={90} />
        <SkeletonGrid columns={2} gap={12}>
          <ProductCardSkeleton variant="related" />
          <ProductCardSkeleton variant="related" />
        </SkeletonGrid>
      </View>
    </SkeletonStack>
  );
}

export function SearchResultsSkeleton() {
  const tokens = useThemeTokens();
  return (
    <SkeletonStack gap={tokens.space.md}>
      <SkeletonBlock height={16} width={110} />
      <CollectionTileSkeleton />
      <CreatorCardSkeleton />
      <ProductCardSkeleton variant="related" />
      <ProductCardSkeleton variant="related" />
    </SkeletonStack>
  );
}

export function SearchMoreSkeleton() {
  return (
    <SkeletonStack gap={12} style={{ paddingVertical: 8 }}>
      <ProductCardSkeleton variant="related" />
      <CollectionTileSkeleton />
    </SkeletonStack>
  );
}
