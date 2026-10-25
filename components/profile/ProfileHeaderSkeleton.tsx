import React from 'react';
import { StyleSheet, View } from 'react-native';

import { SkeletonBlock } from '@/components/status/SkeletonBlock';
import { useThemeTokens } from '@/src/theme/useThemeTokens';

const AVATAR_SIZE = 72;

export function ProfileHeaderSkeleton() {
  const tokens = useThemeTokens();
  return (
    <View style={{ gap: tokens.space.md }}>
      <View style={[styles.heroRow, { gap: tokens.space.md }]}>
        <SkeletonBlock width={AVATAR_SIZE} height={AVATAR_SIZE} radius={AVATAR_SIZE / 2} />
        <View style={[styles.statsFlex, { gap: 8 }]}>
          <SkeletonBlock height={18} width="70%" />
          <SkeletonBlock height={13} width="40%" />
          <View style={[styles.stats, { gap: tokens.space.md }]}>
            <SkeletonBlock height={28} width={48} />
            <SkeletonBlock height={28} width={48} />
            <SkeletonBlock height={28} width={48} />
          </View>
        </View>
      </View>
      <SkeletonBlock height={13} />
      <SkeletonBlock height={13} width="85%" />
      <View style={[styles.actions, { gap: tokens.space.sm }]}>
        <SkeletonBlock height={36} radius={tokens.radius.pill} style={{ flex: 1 }} />
        <SkeletonBlock height={36} radius={tokens.radius.pill} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statsFlex: {
    flex: 1,
    minWidth: 0,
  },
  stats: {
    flexDirection: 'row',
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
  },
});
