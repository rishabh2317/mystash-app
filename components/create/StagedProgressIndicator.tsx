import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useThemeTokens } from '@/src/theme/useThemeTokens';
import type { IngestProgressStageView } from '@/src/ui/ingestProgressStages';

type Props = {
  stages: IngestProgressStageView[];
  hint?: string;
};

/**
 * Horizontal segmented progress for ingest/extraction waits.
 * Uses real stage labels; no numeric percentage.
 */
export function StagedProgressIndicator({ stages, hint }: Props) {
  const tokens = useThemeTokens();
  const active = stages.find((stage) => stage.state === 'active');

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={active?.label}
      style={[styles.wrap, { gap: tokens.space.sm }]}
    >
      <View style={[styles.track, { gap: tokens.space.xxs }]}>
        {stages.map((stage) => (
          <View
            key={stage.id}
            style={[
              styles.segment,
              {
                backgroundColor:
                  stage.state === 'failed'
                    ? tokens.color.danger
                    : stage.state === 'pending'
                      ? tokens.color.border
                      : tokens.color.accent,
                opacity:
                  stage.state === 'pending' ? 0.35 : stage.state === 'active' ? 1 : 0.9,
                borderRadius: tokens.radius.pill,
                height: stage.state === 'active' ? 5 : 4,
              },
            ]}
            accessibilityElementsHidden
          />
        ))}
      </View>
      {active ? (
        <Text
          style={{
            color: tokens.color.text,
            fontSize: tokens.fontSize.bodyStrong,
            fontWeight: tokens.fontWeight.bold,
            textAlign: 'center',
          }}
        >
          {active.label}
        </Text>
      ) : null}
      {hint ? (
        <Text
          style={{
            color: tokens.color.textMuted,
            fontSize: 13,
            lineHeight: 18,
            textAlign: 'center',
          }}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    paddingHorizontal: 8,
  },
  track: {
    flexDirection: 'row',
    width: '100%',
  },
  segment: {
    flex: 1,
  },
});
