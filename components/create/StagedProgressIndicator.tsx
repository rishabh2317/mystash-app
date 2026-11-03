import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Text as AppText } from '@/components/ui/Text';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import type { IngestProgressStageView } from '@/src/ui/ingestProgressStages';

type Props = {
  stages: IngestProgressStageView[];
  appearance?: 'default' | 'studio';
  hint?: string;
};

/**
 * Horizontal segmented progress for ingest/extraction waits.
 * Uses real stage labels; no numeric percentage.
 */
export function StagedProgressIndicator({ stages, hint, appearance = 'default' }: Props) {
  const tokens = useThemeTokens();
  const studio = appearance === 'studio';
  const active = stages.find((stage) => stage.state === 'active');

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={active?.label}
      style={[styles.wrap, { gap: tokens.space.sm, paddingHorizontal: tokens.space.xs }, studio && { paddingVertical: tokens.space.sm }]}
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
                      : tokens.color.primary,
                opacity:
                  stage.state === 'pending' ? 0.35 : stage.state === 'active' ? 1 : 0.9,
                borderRadius: tokens.radius.pill,
                height: studio ? 5 : stage.state === 'active' ? 5 : 4,
              },
            ]}
            accessibilityElementsHidden
          />
        ))}
      </View>
      {active ? (
        <AppText
          style={{
            color: tokens.color.text,
            fontSize: tokens.fontSize.bodyStrong,
            lineHeight: tokens.lineHeight.bodyStrong,
            fontFamily: tokens.fontFamily.bold,
            textAlign: 'center',
          }}
        >
          {active.label}
        </AppText>
      ) : null}
      {hint ? (
        <AppText
          style={{
            color: tokens.color.textMuted,
            fontSize: tokens.fontSize.caption,
            lineHeight: tokens.lineHeight.caption,
            textAlign: 'center',
          }}
        >
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
  },
  track: {
    flexDirection: 'row',
    width: '100%',
  },
  segment: {
    flex: 1,
  },
});
