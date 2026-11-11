import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';

import { useThemeMode } from '@/contexts/ThemeContext';
import { informationCardShadow, outlineCardChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';

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
          style={[typeStyle(tokens, 'caption'), {
            fontFamily: tokens.fontFamily.semibold,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            paddingHorizontal: tokens.space.xxs,
          }]}
        >
          {title}
        </Text>
      ) : null}
      <View style={{ ...informationCardShadow(tokens), borderRadius: tokens.radius.xl }}>
        <View
          style={[
            styles.group,
            {
              ...outlineCardChrome(tokens),
              borderRadius: tokens.radius.xl,
              shadowOpacity: 0,
              elevation: 0,
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
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
});
