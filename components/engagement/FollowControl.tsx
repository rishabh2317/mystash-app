import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
} from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { hitSlopToMinTarget } from '@/src/ui/feedA11y';

type Props = {
  isFollowing: boolean;
  pending?: boolean;
  disabled?: boolean;
  /**
   * `compact` — inline chip beside a name.
   * `micro` — quiet credit line (e.g. Collection “Curated by”).
   */
  size?: 'default' | 'compact' | 'micro';
  /**
   * Unfollowed default CTA fills with inverse text (Collection).
   * `brand` uses the shared primary — public creator storefront only.
   */
  emphasis?: 'default' | 'brand';
  /** Stretch to parent width (public profile Follow | Share row). */
  fullWidth?: boolean;
  /** Shorter profile CTA height (LTK-style stretched row). */
  slim?: boolean;
  /** White-on-dark styling for controls resting on media (reel overlays). */
  immersive?: boolean;
  /** @deprecated Colors come from ThemeMode tokens. */
  isLight?: boolean;
  labelOverride?: string;
  onPress: () => void;
};

export function FollowControl({
  isFollowing,
  pending = false,
  disabled = false,
  size = 'default',
  emphasis = 'default',
  fullWidth = false,
  slim = false,
  immersive = false,
  labelOverride,
  onPress,
}: Props) {
  const { tokens } = useThemeMode();
  const [pressed, setPressed] = React.useState(false);
  const phase = resolveControlPhase({
    disabled,
    pending,
    success: isFollowing,
    pressed,
  });
  const compact = size === 'compact';
  const micro = size === 'micro';
  const inline = compact || micro;
  const hit = micro
    ? hitSlopToMinTarget(24)
    : compact
      ? hitSlopToMinTarget(28)
      : hitSlopToMinTarget(40);
  const label = labelOverride ?? (isFollowing ? 'Following' : 'Follow');
  /** Compact / micro stay secondary; default Collection CTA fills. */
  const onAccent = !isFollowing && !labelOverride && !inline;
  const brand = onAccent && emphasis === 'brand';
  const restingText = immersive ? tokens.immersive.text : tokens.color.text;
  const accentFill = brand ? tokens.color.primary : tokens.color.text;
  const accentLabel = brand ? tokens.color.onPrimary : tokens.color.textOnAccent;
  const spinnerColor = onAccent ? accentLabel : restingText;
  const labelColor = onAccent ? accentLabel : restingText;
  const labelSize = micro
    ? tokens.fontSize.micro
    : compact || slim
      ? tokens.fontSize.caption
      : tokens.fontSize.body;
  const surface = immersive ? tokens.immersive.control : tokens.color.overlay;
  const surfaceBorder = immersive ? tokens.immersive.borderStrong : tokens.color.border;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || pending}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || pending, busy: pending, selected: isFollowing }}
      hitSlop={hit}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        micro ? styles.microBtn : compact ? styles.compactBtn : styles.btn,
        fullWidth ? styles.fullWidth : null,
        slim ? styles.slimBtn : null,
        {
          borderRadius: micro || compact
            ? tokens.radius.sm
            : fullWidth
              ? tokens.radius.pill
              : tokens.radius.md,
          borderWidth: tokens.stroke.hairline,
          backgroundColor: onAccent ? accentFill : surface,
          borderColor: onAccent ? 'transparent' : surfaceBorder,
          opacity: controlOpacity(phase, tokens.motion.pressOpacity),
          ...(micro
            ? {
                // Taller than micro type so glyphs/descenders aren’t clipped.
                height: tokens.lineHeight.caption,
                paddingHorizontal: tokens.space.xs,
                paddingBottom: 1,
              }
            : null),
        },
      ]}
    >
      {pending ? (
        <ActivityIndicator color={spinnerColor} size={inline ? 'small' : undefined} />
      ) : (
        <Text
          style={[
            styles.label,
            {
              color: labelColor,
              fontSize: labelSize,
              fontWeight: micro ? '600' : '700',
              ...(micro
                ? {
                    lineHeight: tokens.lineHeight.caption,
                    includeFontPadding: false,
                    textAlignVertical: 'center' as const,
                  }
                : null),
            },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minWidth: 110,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  compactBtn: {
    minWidth: 0,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  microBtn: {
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  fullWidth: {
    width: '100%',
    minWidth: 0,
  },
  slimBtn: {
    height: 32,
    paddingHorizontal: 12,
  },
  label: {
    fontWeight: '700',
  },
});
