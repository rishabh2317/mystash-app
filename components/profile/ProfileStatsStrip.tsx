import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { formatEngagementCount } from '@/src/ui/formatEngagementCount';

export type ProfileStatItem = {
  id: string;
  value: number;
  label: string;
  onPress?: () => void;
};

type Props = {
  stats: ProfileStatItem[];
  accessibilityLabel?: string;
  /**
   * Public profile: tighter columns, left-aligned so the name above
   * lines up with the first label (“Posts”).
   */
  compact?: boolean;
};

/**
 * Quiet profile figures — number over label, no card chrome.
 * Matches Stash tileMeta / tileTitle rhythm.
 */
export function ProfileStatsStrip({ stats, accessibilityLabel, compact = false }: Props) {
  const { tokens } = useThemeMode();
  if (stats.length === 0) return null;

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={
        accessibilityLabel ??
        stats.map((stat) => `${formatEngagementCount(stat.value)} ${stat.label}`).join(', ')
      }
      style={[styles.row, compact ? styles.rowCompact : null]}
    >
      {stats.map((stat) => {
        const body = (
          <>
            <Text
              style={[
                typeStyle(tokens, compact ? 'tileMeta' : 'tileTitle'),
                compact
                  ? {
                      color: tokens.color.text,
                      fontFamily: tokens.fontFamily.semibold,
                      fontSize: tokens.fontSize.caption,
                      lineHeight: tokens.lineHeight.caption,
                      letterSpacing: -0.2,
                    }
                  : { letterSpacing: -0.2 },
              ]}
            >
              {formatEngagementCount(stat.value)}
            </Text>
            <Text style={typeStyle(tokens, 'tileMeta')} numberOfLines={1}>
              {stat.label}
            </Text>
          </>
        );

        return stat.onPress ? (
          <Pressable
            key={stat.id}
            onPress={stat.onPress}
            accessibilityRole="button"
            accessibilityLabel={`${formatEngagementCount(stat.value)} ${stat.label}`}
            style={({ pressed }) => [
              styles.cell,
              compact ? styles.cellCompact : null,
              {
                opacity: controlOpacity(
                  resolveControlPhase({ pressed }),
                  tokens.motion.pressOpacity,
                ),
              },
            ]}
          >
            {body}
          </Pressable>
        ) : (
          <View key={stat.id} style={[styles.cell, compact ? styles.cellCompact : null]}>
            {body}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  rowCompact: {
    justifyContent: 'flex-start',
    gap: 18,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    minWidth: 0,
    paddingVertical: 2,
  },
  cellCompact: {
    flex: 0,
    alignItems: 'flex-start',
    gap: 1,
    paddingVertical: 0,
    minWidth: 52,
  },
});
