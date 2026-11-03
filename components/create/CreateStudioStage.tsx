import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { LayoutAnimation, Platform, Pressable, StyleSheet, UIManager, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { outlineCardChrome } from '@/src/theme/tokens';
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

/** One numbered card per stage; expansion and locking remain flow-owned. */
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
  const titleColor = tokens.color.text;

  return (
    <View
      style={[
        styles.card,
        outlineCardChrome(tokens),
        {
          marginHorizontal: tokens.space.md,
          marginBottom: tokens.space.sm,
          borderRadius: tokens.radius.xl,
        },
      ]}
    >
      <Pressable
        onPress={onPressHeader}
        disabled={headerDisabled}
        accessibilityRole="button"
        accessibilityState={{ expanded, disabled: headerDisabled }}
        accessibilityLabel={`${copy.index} ${copy.label}`}
        style={({ pressed }) => [
          styles.header,
          {
            padding: tokens.space.md,
            gap: tokens.space.sm,
            opacity: pressed && !headerDisabled ? tokens.motion.pressOpacity : 1,
          },
        ]}
      >
        <View
          style={[
            styles.indexCol,
            {
              backgroundColor: current || complete ? tokens.color.primarySurface : tokens.color.surfaceSubtle,
              borderRadius: tokens.radius.pill,
            },
          ]}
        >
          {complete && !expanded ? (
            <Ionicons name="checkmark" size={18} color={tokens.color.onPrimarySurface} />
          ) : (
            <Text
              style={[
                typeStyle(tokens, 'caption'),
                {
                  color: current ? tokens.color.onPrimarySurface : tokens.color.textMuted,
                  fontFamily: tokens.fontFamily.semibold,
                },
              ]}
            >
              {copy.index}
            </Text>
          )}
        </View>
        <View style={{ flex: 1, gap: tokens.space.xxs }}>
          <Text
            style={[
              typeStyle(tokens, 'sectionTitle'),
              { color: titleColor },
            ]}
          >
            {copy.label}
          </Text>
          <Text
            style={typeStyle(tokens, 'caption')}
            numberOfLines={2}
          >
            {expanded ? subhead : summary}
          </Text>
        </View>
        <View style={[styles.accessories, { gap: tokens.space.xs, paddingTop: tokens.space.xs }]}>
          {locked ? <Ionicons name="lock-closed-outline" size={16} color={tokens.color.textMuted} /> : null}
          <Ionicons
            name={expanded ? 'chevron-up-outline' : 'chevron-down-outline'}
            size={18}
            color={tokens.color.textMuted}
          />
        </View>
      </Pressable>
      {expanded ? (
        <View style={{ gap: tokens.space.sm, padding: tokens.space.md, paddingTop: tokens.space.xs }}>
          {children}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth },
  header: { flexDirection: 'row', alignItems: 'flex-start' },
  indexCol: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  accessories: { flexDirection: 'row', alignItems: 'center' },
});
