import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';
import { FILTER_CHIP_DEPTH, stashFilterChipChrome } from '@/src/theme/tokens';
import { usePrefersReducedMotion } from '@/src/ui/usePrefersReducedMotion';

type Props = {
  selected: boolean;
  onPress: React.ComponentProps<typeof Pressable>['onPress'];
  children: React.ReactNode;
  disabled?: boolean;
  accessibilityRole?: React.ComponentProps<typeof Pressable>['accessibilityRole'];
  accessibilityLabel?: string;
  accessibilityState?: React.ComponentProps<typeof Pressable>['accessibilityState'];
  onLayout?: React.ComponentProps<typeof View>['onLayout'];
  containerStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
};

/** One tactile surface for equal-width groups and horizontal filter rails. */
export function TactileFilterChip({ selected, onPress, children, disabled, accessibilityRole = 'button', accessibilityLabel,
  accessibilityState, onLayout, containerStyle, contentStyle }: Props) {
  const { tokens } = useThemeMode();
  const reduceMotion = usePrefersReducedMotion();
  const [pressed, setPressed] = useState(false);
  const depth = FILTER_CHIP_DEPTH[tokens.mode];
  const motion = useRef(new Animated.Value(selected ? 1 : 0)).current;
  const shadowMotion = useRef(new Animated.Value(selected ? 1 : 0)).current;

  useEffect(() => {
    motion.stopAnimation();
    shadowMotion.stopAnimation();
    const down = selected || pressed;
    if (reduceMotion) { motion.setValue(down ? 1 : 0); shadowMotion.setValue(down ? 1 : 0); return; }
    Animated.timing(motion, { toValue: down ? 1 : 0, duration: 130,
      easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    Animated.timing(shadowMotion, { toValue: down ? 1 : 0, duration: 130,
      easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [motion, shadowMotion, selected, pressed, reduceMotion]);

  const depressed = selected || pressed;
  return <Animated.View onLayout={onLayout} style={[stashFilterChipChrome(tokens, depressed), containerStyle,
    { opacity: disabled ? 0.55 : 1,
      shadowOpacity: shadowMotion.interpolate({ inputRange: [0, 1], outputRange: [depth.shadowOpacity, 0] }),
      transform: [
      { translateY: motion.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }) },
      { scale: motion.interpolate({ inputRange: [0, 1], outputRange: [1, 0.987] }) },
    ] }]}>
    <Pressable disabled={disabled} onPress={onPress} accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel} accessibilityState={{ ...accessibilityState, selected, disabled }}
      onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
      style={[{ borderRadius: tokens.radius.pill, overflow: 'hidden' }, contentStyle]}>
      <View pointerEvents="none" style={{ position: 'absolute', top: 1, left: 12, right: 12, height: depressed ? 2 : 1,
        borderRadius: tokens.radius.pill, backgroundColor: depressed ? depth.innerShade : depth.upperLight }} />
      {children}
    </Pressable>
  </Animated.View>;
}
