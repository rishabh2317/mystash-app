import React from 'react';
import { View } from 'react-native';

import { ProductCardSkeleton } from '@/components/commerce/ProductCardSkeleton';
import { StashCategoryCardSkeleton } from '@/components/commerce/StashCategoryCardSkeleton';
import { SkeletonBlock } from '@/components/status/SkeletonBlock';
import { SkeletonGrid, SkeletonStack } from '@/components/status/SkeletonStack';
import { useThemeTokens } from '@/src/theme/useThemeTokens';

const GUTTER = 16;
const GRID_GAP = 12;

export function StashHomeSkeleton() {
  const tokens = useThemeTokens();
  return (
    <SkeletonStack gap={28} style={{ paddingHorizontal: GUTTER, paddingTop: 8 }}>
      <View style={{ gap: tokens.space.sm }}>
        <SkeletonBlock height={16} width={120} />
        <SkeletonGrid columns={2} gap={GRID_GAP}>
          <StashCategoryCardSkeleton />
          <StashCategoryCardSkeleton />
          <StashCategoryCardSkeleton />
          <StashCategoryCardSkeleton />
        </SkeletonGrid>
      </View>
      <View style={{ gap: tokens.space.sm }}>
        <SkeletonBlock height={16} width={140} />
        <SkeletonGrid columns={2} gap={GRID_GAP}>
          <ProductCardSkeleton variant="related" />
          <ProductCardSkeleton variant="related" />
          <ProductCardSkeleton variant="related" />
          <ProductCardSkeleton variant="related" />
        </SkeletonGrid>
      </View>
    </SkeletonStack>
  );
}
