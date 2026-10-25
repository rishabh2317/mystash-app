import React from 'react';
import { StyleSheet, View } from 'react-native';

import { SkeletonBlock } from '@/components/status/SkeletonBlock';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { outlineCardChrome } from '@/src/theme/tokens';

export function CreatorCardSkeleton() {
  const tokens = useThemeTokens();
  return (
    <View
      style={[
        styles.card,
        {
          ...outlineCardChrome(tokens),
        },
      ]}
    >
      <SkeletonBlock width={52} height={52} radius={26} />
      <View style={styles.body}>
        <SkeletonBlock height={16} width="55%" />
        <SkeletonBlock height={13} width="35%" />
        <SkeletonBlock height={12} width="70%" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  body: { flex: 1, gap: 6 },
});
