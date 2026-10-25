import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import {
  CREATE_MODES,
  CREATE_MODE_LABELS,
  type CreateMode,
} from '@/src/ui/createMode';

type Props = {
  mode: CreateMode;
  onChange: (mode: CreateMode) => void;
};

/** Lightweight 3-option Create entry tablist (Phase 1). */
export function CreateModeSwitch({ mode, onChange }: Props) {
  const { tokens } = useThemeMode();

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: tokens.color.surface,
          borderColor: tokens.color.border,
          borderRadius: tokens.radius.md,
          padding: tokens.space.xxs,
          gap: tokens.space.xxs,
        },
      ]}
      accessibilityRole="tablist"
      accessibilityLabel="Create mode"
    >
      {CREATE_MODES.map((id) => {
        const selected = mode === id;
        const label = CREATE_MODE_LABELS[id];
        return (
          <Pressable
            key={id}
            onPress={() => onChange(id)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={label}
            style={({ pressed }) => [
              styles.option,
              {
                borderRadius: tokens.radius.sm,
                paddingHorizontal: tokens.space.sm,
                paddingVertical: tokens.space.xxs + 2,
                backgroundColor: selected ? tokens.color.primary : 'transparent',
                opacity: controlOpacity(
                  resolveControlPhase({ pressed }),
                  tokens.motion.pressOpacity,
                ),
              },
            ]}
          >
            <Text
              style={[
                typeStyle(tokens, selected ? 'cta' : 'tileMeta'),
                {
                  color: selected ? tokens.color.onPrimary : tokens.color.textMuted,
                  fontSize: tokens.fontSize.caption,
                  lineHeight: tokens.lineHeight.caption,
                },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    borderWidth: StyleSheet.hairlineWidth,
  },
  option: {
    flex: 1,
    minHeight: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
