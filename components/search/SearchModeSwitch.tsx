import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';

export type SearchUtilityMode = 'search' | 'paste_url';

type Props = {
  mode: SearchUtilityMode;
  onChange: (mode: SearchUtilityMode) => void;
};

const OPTIONS: { id: SearchUtilityMode; label: string }[] = [
  { id: 'search', label: 'Search' },
  { id: 'paste_url', label: 'Paste URL' },
];

/** Compact mode switch under the Search utility input. */
export function SearchModeSwitch({ mode, onChange }: Props) {
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
    >
      {OPTIONS.map((option) => {
        const selected = mode === option.id;
        return (
          <Pressable
            key={option.id}
            onPress={() => onChange(option.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            style={({ pressed }) => [
              styles.option,
              {
                borderRadius: tokens.radius.sm,
                paddingHorizontal: tokens.space.sm,
                paddingVertical: tokens.space.xxs + 2,
                backgroundColor: selected ? tokens.color.primary : 'transparent',
                opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
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
              {option.label}
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
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
  },
  option: {
    minHeight: 30,
    justifyContent: 'center',
  },
});
