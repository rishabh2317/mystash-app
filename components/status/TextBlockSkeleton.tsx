import React from 'react';
import { View } from 'react-native';

import { SkeletonBlock } from '@/components/status/SkeletonBlock';
import { useThemeTokens } from '@/src/theme/useThemeTokens';

/** Short centered copy placeholder for count-only screens (followers/following). */
export function TextBlockSkeleton() {
  const tokens = useThemeTokens();
  return (
    <View style={{ alignItems: 'center', gap: tokens.space.sm, paddingHorizontal: 28 }}>
      <SkeletonBlock height={18} width="55%" />
      <SkeletonBlock height={14} width="80%" />
      <SkeletonBlock height={14} width="70%" />
    </View>
  );
}
