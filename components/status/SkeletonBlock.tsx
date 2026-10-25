import React, { useEffect } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { usePrefersReducedMotion } from '@/src/ui/usePrefersReducedMotion';

const PULSE_MS = 1200;

type Dimension = number | `${number}%`;

type Props = {
  width?: Dimension;
  height?: Dimension;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

/** Quiet placeholder block. Pulses unless the OS asks for reduced motion. */
export function SkeletonBlock({ width, height, radius, style }: Props) {
  const tokens = useThemeTokens();
  const reduceMotion = usePrefersReducedMotion();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
      pulse.value = 1;
      return;
    }
    pulse.value = 0.45;
    pulse.value = withRepeat(
      withTiming(1, { duration: PULSE_MS, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: pulse.value,
  }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: width ?? '100%',
          height,
          borderRadius: radius ?? tokens.radius.md,
          backgroundColor: tokens.color.surfaceSubtle,
        },
        animatedStyle,
        style,
      ]}
    />
  );
}
