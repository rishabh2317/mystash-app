import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';
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
};

/**
 * Editorial stat figures for public and personal profile.
 * Numbers carry the weight; labels stay quiet. No icons, no card chrome.
 */
export function ProfileStatsStrip({ stats, accessibilityLabel }: Props) {
  const { tokens } = useThemeMode();
  if (stats.length === 0) return null;

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={
        accessibilityLabel ??
        stats.map((stat) => `${formatEngagementCount(stat.value)} ${stat.label}`).join(', ')
      }
      style={styles.row}
    >
      {stats.map((stat, index) => {
        const body = (
          <>
            <Text
              style={{
                color: tokens.color.text,
                fontSize: tokens.fontSize.display,
                lineHeight: tokens.lineHeight.display,
                fontWeight: tokens.fontWeight.extraBold,
                letterSpacing: -0.4,
              }}
            >
              {formatEngagementCount(stat.value)}
            </Text>
            <Text
              style={{
                color: tokens.color.textMuted,
                fontSize: tokens.fontSize.micro,
                lineHeight: tokens.lineHeight.micro,
                fontWeight: tokens.fontWeight.semibold,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
              }}
              numberOfLines={1}
            >
              {stat.label}
            </Text>
          </>
        );

        return (
          <React.Fragment key={stat.id}>
            {index > 0 ? (
              <View
                style={[
                  styles.rule,
                  { backgroundColor: tokens.color.divider, height: tokens.space.xl },
                ]}
              />
            ) : null}
            {stat.onPress ? (
              <Pressable
                onPress={stat.onPress}
                accessibilityRole="button"
                accessibilityLabel={`${formatEngagementCount(stat.value)} ${stat.label}`}
                style={({ pressed }) => [
                  styles.cell,
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
              <View style={styles.cell}>{body}</View>
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    minWidth: 0,
    paddingVertical: 4,
  },
  rule: {
    width: StyleSheet.hairlineWidth,
  },
});
