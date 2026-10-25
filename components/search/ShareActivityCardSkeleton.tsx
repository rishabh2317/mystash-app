import React from 'react';
import { StyleSheet, View } from 'react-native';

import { SkeletonBlock } from '@/components/status/SkeletonBlock';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { outlineCardChrome } from '@/src/theme/tokens';

export function ShareActivityCardSkeleton() {
  const tokens = useThemeTokens();
  return (
    <View
      style={[
        styles.wrap,
        {
          ...outlineCardChrome(tokens),
          borderRadius: tokens.radius.lg,
        },
      ]}
    >
      <View style={styles.card}>
        <SkeletonBlock width={48} height={48} radius={tokens.radius.md} />
        <View style={styles.body}>
          <SkeletonBlock height={14} width="60%" />
          <SkeletonBlock height={13} />
          <SkeletonBlock height={12} width="35%" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  body: {
    flex: 1,
    gap: 6,
  },
});
