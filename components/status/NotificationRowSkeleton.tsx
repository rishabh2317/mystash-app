import React from 'react';
import { StyleSheet, View } from 'react-native';

import { SkeletonBlock } from '@/components/status/SkeletonBlock';
import { useThemeTokens } from '@/src/theme/useThemeTokens';

export function NotificationRowSkeleton() {
  const tokens = useThemeTokens();
  return (
    <View
      style={[
        styles.row,
        {
          paddingHorizontal: tokens.space.lg,
          paddingVertical: tokens.space.sm,
          gap: tokens.space.sm,
        },
      ]}
    >
      <SkeletonBlock width={40} height={40} radius={20} />
      <View style={{ flex: 1, gap: 6 }}>
        <SkeletonBlock height={15} width="70%" />
        <SkeletonBlock height={13} />
        <SkeletonBlock height={13} width="85%" />
      </View>
      <SkeletonBlock width={24} height={12} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
});
