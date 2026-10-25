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
          paddingHorizontal: tokens.space.lg,
          paddingVertical: tokens.space.sm,
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
          const color = isCurrent
            ? tokens.color.primary
            : isComplete
              ? tokens.color.text
              : tokens.color.textMuted;

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
                  { opacity: !unlocked ? 0.45 : pressed ? tokens.motion.pressOpacity : 1 },
                ]}
              >
                {isComplete ? (
                  <Ionicons name="checkmark" size={12} color={tokens.color.primary} />
                ) : (
                  <Text
                    style={[
                      typeStyle(tokens, 'tileMeta'),
                      {
                        color,
                        fontFamily: tokens.fontFamily.semibold,
                        letterSpacing: 0.6,
                      },
                    ]}
                  >
                    {copy.index}
                  </Text>
                )}
                <Text
                  style={[
                    typeStyle(tokens, isCurrent ? 'tileTitle' : 'tileMeta'),
                    { color, fontSize: tokens.fontSize.caption, lineHeight: tokens.lineHeight.caption },
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
    gap: 6,
    paddingVertical: 2,
  },
  connector: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 10,
  },
});
