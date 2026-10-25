import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { LayoutAnimation, Platform, Pressable, StyleSheet, UIManager, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import {
  STUDIO_STEP_COPY,
  studioStepVisual,
  type StudioProgressContext,
  type StudioStepId,
} from '@/src/ui/createStudioFlow';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export function configureStudioStageAnimation(reduceMotion: boolean): void {
  if (reduceMotion) return;
  LayoutAnimation.configureNext({
    duration: 280,
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });
}

type Props = {
  step: StudioStepId;
  expanded: boolean;
  locked: boolean;
  progress: StudioProgressContext;
  active: StudioStepId;
  summary: string;
  subhead: string;
  onPressHeader: () => void;
  children: React.ReactNode;
};

/** Collapsed compact row or expanded editorial stage. */
export function CreateStudioStage({
  step,
  expanded,
  locked,
  progress,
  active,
  summary,
  subhead,
  onPressHeader,
  children,
}: Props) {
  const { tokens } = useThemeMode();
  const copy = STUDIO_STEP_COPY[step];
  const visual = studioStepVisual(step, active, progress);
  const complete = visual === 'completed';
  const current = visual === 'current';
  const headerDisabled = locked && !complete && !current;
  const titleColor = locked ? tokens.color.textMuted : tokens.color.text;

  return (
    <View style={{ paddingHorizontal: tokens.space.lg }}>
      <Pressable
        onPress={onPressHeader}
        disabled={headerDisabled}
        accessibilityRole="button"
        accessibilityState={{ expanded, disabled: headerDisabled }}
        accessibilityLabel={`${copy.index} ${copy.label}`}
        style={({ pressed }) => [
          styles.header,
          {
            paddingVertical: expanded ? tokens.space.md : tokens.space.sm + 2,
            opacity: pressed && !headerDisabled ? tokens.motion.pressOpacity : 1,
          },
        ]}
      >
        <View style={styles.indexCol}>
          {complete && !expanded ? (
            <Ionicons name="checkmark" size={14} color={tokens.color.primary} />
          ) : locked && !expanded ? (
            <Ionicons name="lock-closed-outline" size={13} color={tokens.color.textMuted} />
          ) : (
            <Text
              style={[
                typeStyle(tokens, 'tileMeta'),
                {
                  color: current ? tokens.color.primary : tokens.color.textMuted,
                  fontFamily: tokens.fontFamily.semibold,
                  letterSpacing: 1,
                },
              ]}
            >
              {copy.index}
            </Text>
          )}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={[
              typeStyle(tokens, 'sectionTitle'),
              { color: titleColor, fontSize: expanded ? tokens.fontSize.title : tokens.fontSize.bodyStrong },
            ]}
          >
            {copy.label}
          </Text>
          <Text
            style={[
              typeStyle(tokens, 'bodyMuted'),
              { fontSize: tokens.fontSize.caption, lineHeight: tokens.lineHeight.caption },
            ]}
            numberOfLines={2}
          >
            {expanded ? subhead : summary}
          </Text>
        </View>
        {headerDisabled ? null : (
          <Ionicons
            name={expanded ? 'chevron-down-outline' : 'chevron-forward-outline'}
            size={16}
            color={tokens.color.textMuted}
          />
        )}
      </Pressable>
      {expanded ? <View style={{ gap: tokens.space.md, paddingBottom: tokens.space.xl }}>{children}</View> : null}
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: tokens.color.divider }} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  indexCol: {
    width: 22,
    paddingTop: 4,
    alignItems: 'center',
  },
});
