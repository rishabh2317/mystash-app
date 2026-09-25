import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';
import { outlineCardChrome } from '@/src/theme/tokens';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { PERSONAL_PROFILE_COPY } from '@/src/ui/personalProfile';

type Props = {
  onPress: () => void;
};

export function PersonalCreateCollectionCard({ onPress }: Props) {
  const { tokens } = useThemeMode();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={PERSONAL_PROFILE_COPY.createTitle}
      style={({ pressed }) => [
        styles.card,
        {
          ...outlineCardChrome(tokens),
          borderRadius: tokens.radius.xxl,
          padding: tokens.space.md,
          gap: tokens.space.sm,
          opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
        },
      ]}
    >
      <View
        style={[
          styles.icon,
          {
            borderColor: tokens.color.primary,
            borderRadius: tokens.radius.pill,
          },
        ]}
      >
        <Ionicons name="add-outline" size={20} color={tokens.color.primary} />
      </View>
      <View style={styles.copy}>
        <Text
          style={{
            color: tokens.color.text,
            fontSize: tokens.fontSize.bodyStrong,
            lineHeight: tokens.lineHeight.bodyStrong,
            fontWeight: tokens.fontWeight.bold,
          }}
        >
          {PERSONAL_PROFILE_COPY.createTitle}
        </Text>
        <Text
          style={{
            color: tokens.color.textMuted,
            fontSize: tokens.fontSize.caption,
            lineHeight: tokens.lineHeight.caption,
          }}
        >
          {PERSONAL_PROFILE_COPY.createSubtitle}
        </Text>
      </View>
      <View style={[styles.action, { gap: tokens.space.xxs }]} accessibilityElementsHidden>
        <Text
          style={{
            color: tokens.color.primary,
            fontSize: tokens.fontSize.label,
            lineHeight: tokens.lineHeight.label,
            fontWeight: tokens.fontWeight.bold,
          }}
          numberOfLines={1}
        >
          {PERSONAL_PROFILE_COPY.createAction}
        </Text>
        <Ionicons name="chevron-forward-outline" size={14} color={tokens.color.primary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  icon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  action: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
