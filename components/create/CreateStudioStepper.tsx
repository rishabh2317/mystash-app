import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import { CREATE_COPY } from '@/src/ui/createCopy';
import {
  STUDIO_STEPS,
  STUDIO_STEP_COPY,
  studioConnectorComplete,
  studioStepUnlocked,
  studioStepVisual,
  type StudioProgressContext,
  type StudioStepId,
} from '@/src/ui/createStudioFlow';

type Props = {
  active: StudioStepId;
  progress: StudioProgressContext;
  onPressStep: (step: StudioStepId) => void;
};

/** Compact progress rail — not a segmented control. */
export function CreateStudioStepper({ active, progress, onPressStep }: Props) {
  const { tokens } = useThemeMode();

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={CREATE_COPY.studioHeadline}
      style={[
        styles.wrap,
        {
          backgroundColor: tokens.color.canvas,
          borderBottomColor: tokens.color.divider,
          marginBottom: tokens.space.sm,
          paddingHorizontal: tokens.space.md,
          paddingTop: tokens.space.sm,
          paddingBottom: tokens.space.sm,
        },
      ]}
    >
      <View style={styles.row}>
        {STUDIO_STEPS.map((id, index) => {
          const visual = studioStepVisual(id, active, progress);
          const unlocked = studioStepUnlocked(id, progress);
          const copy = STUDIO_STEP_COPY[id];
          const isCurrent = visual === 'current';
          const isComplete = visual === 'completed';
          const color = isCurrent || isComplete ? tokens.color.text : tokens.color.textMuted;

          return (
            <React.Fragment key={id}>
              <Pressable
                onPress={() => {
                  if (unlocked) onPressStep(id);
                }}
                disabled={!unlocked}
                accessibilityRole="tab"
                accessibilityState={{ selected: isCurrent, disabled: !unlocked }}
                accessibilityLabel={`${copy.index} ${copy.label}`}
                style={({ pressed }) => [
                  styles.step,
                  { gap: tokens.space.xs, opacity: pressed ? tokens.motion.pressOpacity : 1 },
                ]}
              >
                <View
                  style={[
                    styles.badge,
                    {
                      borderRadius: tokens.radius.pill,
                      backgroundColor: isCurrent ? tokens.color.primary : isComplete ? tokens.color.primarySurface : tokens.color.surfaceSubtle,
                    },
                  ]}
                >
                  {isComplete ? (
                    <Ionicons name="checkmark" size={16} color={tokens.color.onPrimarySurface} />
                  ) : (
                    <Text
                      style={[
                        typeStyle(tokens, 'tileTitle'),
                        { color: isCurrent ? tokens.color.onPrimary : tokens.color.textMuted },
                      ]}
                    >
                      {copy.index}
                    </Text>
                  )}
                </View>
                <Text
                  style={[
                    typeStyle(tokens, isCurrent ? 'tileTitle' : 'tileMeta'),
                    { color, fontSize: tokens.fontSize.caption, lineHeight: tokens.lineHeight.caption, flexShrink: 1 },
                  ]}
                >
                  {copy.label}
                </Text>
              </Pressable>
              {index < STUDIO_STEPS.length - 1 ? (
                <View
                  style={[
                    styles.connector,
                    {
                      marginHorizontal: tokens.space.xs,
                      minWidth: tokens.space.xs,
                      backgroundColor: studioConnectorComplete(id, progress)
                        ? tokens.color.primary
                        : tokens.color.divider,
                    },
                  ]}
                  accessibilityElementsHidden
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    flexShrink: 1,
  },
  badge: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  connector: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
});
