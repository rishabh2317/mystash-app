import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';

type Props = {
  title?: string;
  children: React.ReactNode;
};

/** One surface per settings group — rows share hairline dividers. */
export function SettingsSection({ title, children }: Props) {
  const { tokens } = useThemeMode();
  const items = React.Children.toArray(children).filter(Boolean);

  return (
    <View style={{ gap: tokens.space.xs }}>
      {title ? (
        <Text
          style={{
            color: tokens.color.textMuted,
            fontSize: tokens.fontSize.caption,
            lineHeight: tokens.lineHeight.caption,
            fontWeight: tokens.fontWeight.bold,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            paddingHorizontal: tokens.space.xxs,
          }}
        >
          {title}
        </Text>
      ) : null}
      <View
        style={[
          styles.group,
          {
            backgroundColor: tokens.color.surface,
            borderColor: tokens.color.border,
            borderRadius: tokens.radius.xl,
          },
        ]}
      >
        {items.map((child, index) => (
          <View
            key={index}
            style={{
              borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
              borderTopColor: tokens.color.divider,
            }}
          >
            {child}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
});
