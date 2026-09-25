import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { settingsRowShowsChevron } from '@/src/ui/settingsHub';

export type SettingsRowVariant =
  | 'navigation'
  | 'value'
  | 'toggle'
  | 'highlighted'
  | 'destructive';

type Props = {
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle?: string | null;
  value?: string | null;
  variant?: SettingsRowVariant;
  onPress?: () => void;
  disabled?: boolean;
  toggleValue?: boolean;
  onToggle?: (next: boolean) => void;
  accessibilityLabel?: string;
};

const ICON_SIZE = 20;

/**
 * Compact settings row. One implementation for navigation, value, toggle,
 * highlighted tool, and destructive actions — parents own destinations.
 */
export function SettingsRow({
  icon,
  title,
  subtitle,
  value,
  variant = 'value',
  onPress,
  disabled = false,
  toggleValue = false,
  onToggle,
  accessibilityLabel,
}: Props) {
  const { tokens } = useThemeMode();
  const canPress = Boolean(onPress) || (variant === 'toggle' && Boolean(onToggle));
  const showChevron = settingsRowShowsChevron({
    variant,
    hasAction: Boolean(onPress),
  });
  const highlighted = variant === 'highlighted';
  const destructive = variant === 'destructive';
  const titleColor = destructive ? tokens.color.danger : tokens.color.text;
  const iconColor = highlighted
    ? tokens.color.primary
    : destructive
      ? tokens.color.danger
      : tokens.color.icon;

  const body = (
    <>
      {icon ? <Ionicons name={icon} size={ICON_SIZE} color={iconColor} /> : null}
      <View style={styles.copy}>
        <Text
          style={{
            color: titleColor,
            fontSize: tokens.fontSize.bodyStrong,
            lineHeight: tokens.lineHeight.bodyStrong,
            fontWeight: tokens.fontWeight.bold,
          }}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={{
              color: tokens.color.textMuted,
              fontSize: tokens.fontSize.caption,
              lineHeight: tokens.lineHeight.caption,
              marginTop: 2,
            }}
            numberOfLines={2}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text
          style={{
            color: tokens.color.textMuted,
            fontSize: tokens.fontSize.caption,
            lineHeight: tokens.lineHeight.caption,
            fontWeight: tokens.fontWeight.semibold,
            flexShrink: 1,
            maxWidth: '42%',
            textAlign: 'right',
          }}
          numberOfLines={1}
        >
          {value}
        </Text>
      ) : null}
      {variant === 'toggle' && onToggle ? (
        <Switch
          value={toggleValue}
          onValueChange={onToggle}
          disabled={disabled}
          pointerEvents="none"
          trackColor={{ false: tokens.color.border, true: tokens.color.primary }}
          thumbColor={tokens.color.surface}
          ios_backgroundColor={tokens.color.border}
        />
      ) : null}
      {showChevron ? (
        <Ionicons name="chevron-forward-outline" size={16} color={tokens.color.textMuted} />
      ) : null}
    </>
  );

  const rowStyle = ({ pressed }: { pressed: boolean }) => [
    styles.row,
    {
      paddingHorizontal: tokens.space.md,
      paddingVertical: highlighted ? tokens.space.md : tokens.space.sm,
      gap: tokens.space.sm,
      backgroundColor: highlighted ? tokens.color.primarySurface : 'transparent',
      opacity: controlOpacity(
        resolveControlPhase({ pressed, disabled }),
        tokens.motion.pressOpacity,
      ),
    },
  ];

  if (!canPress) {
    return (
      <View accessibilityLabel={accessibilityLabel ?? title} style={rowStyle({ pressed: false })}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={
        onPress ??
        (onToggle
          ? () => {
              onToggle(!toggleValue);
            }
          : undefined)
      }
      disabled={disabled}
      accessibilityRole={variant === 'toggle' ? 'switch' : 'button'}
      accessibilityState={{
        disabled,
        checked: variant === 'toggle' ? toggleValue : undefined,
      }}
      accessibilityLabel={accessibilityLabel ?? title}
      style={rowStyle}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
});
