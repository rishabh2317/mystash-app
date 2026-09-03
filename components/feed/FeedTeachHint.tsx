import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';
import { FEED_MIN_HIT_TARGET, FEED_TEACH_COPY } from '@/src/ui/feedA11y';

type Props = {
  visible: boolean;
  onDismiss: () => void;
};

export function FeedTeachHint({ visible, onDismiss }: Props) {
  const { tokens } = useThemeMode();
  if (!visible) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { left: tokens.space.md, right: tokens.space.md }]}
    >
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={`${FEED_TEACH_COPY}. Dismiss`}
        style={[
          styles.card,
          {
            backgroundColor: tokens.color.surfaceRaised,
            borderColor: tokens.color.border,
            borderRadius: tokens.radius.md,
            paddingHorizontal: tokens.space.md,
            paddingVertical: tokens.space.sm,
            minHeight: FEED_MIN_HIT_TARGET,
            gap: tokens.space.xs,
          },
        ]}
      >
        <Text
          style={{
            flex: 1,
            color: tokens.color.text,
            fontSize: tokens.fontSize.body,
            fontWeight: tokens.fontWeight.semibold,
          }}
        >
          {FEED_TEACH_COPY}
        </Text>
        <Text
          style={{
            color: tokens.color.primary,
            fontSize: tokens.fontSize.bodyStrong,
            fontWeight: tokens.fontWeight.bold,
          }}
        >
          Got it
        </Text>
      </Pressable>
    </View>
  );
}

/** Clears the immersive TopBar row on every supported device. */
const TOP_BAR_CLEARANCE = 96;

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: TOP_BAR_CLEARANCE,
    zIndex: 25,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
