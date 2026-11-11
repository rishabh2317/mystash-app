import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { useThemeMode } from '@/contexts/ThemeContext';
import { FILTER_CHIP_DEPTH, filterChipAmbientChrome, stashFilterChipChrome } from '@/src/theme/tokens';
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
  // Keep native transform and JS shadow graphs on separate Animated.Views.
  // Promoting a shared style graph to native also promotes shadowMotion; the
  // subsequent JS timing then throws on Android/iOS during screen mount.
  return <Animated.View onLayout={onLayout} style={[filterChipAmbientChrome(tokens, depressed), containerStyle,
    { opacity: disabled ? 0.55 : 1,
      transform: [
      { translateY: motion.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }) },
      { scale: motion.interpolate({ inputRange: [0, 1], outputRange: [1, 0.987] }) },
    ] }]}>
    <Animated.View style={[stashFilterChipChrome(tokens, depressed), {
      flexGrow: 1,
      shadowOpacity: shadowMotion.interpolate({ inputRange: [0, 1], outputRange: [depth.shadowOpacity, depth.pressedShadowOpacity] }),
    }]}>
      <Pressable disabled={disabled} onPress={onPress} accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel} accessibilityState={{ ...accessibilityState, selected, disabled }}
        onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
        style={[{ flexGrow: 1, borderRadius: tokens.radius.pill, overflow: 'hidden' }, contentStyle]}>
        <LinearGradient pointerEvents="none" colors={depressed ? depth.pressedRim : depth.raisedRim}
          locations={[0, 0.5, 1]} style={[StyleSheet.absoluteFill, { borderRadius: tokens.radius.pill }]}>
          <LinearGradient colors={depressed ? depth.pressedBlend : depth.raisedBlend}
            locations={[0, 0.5, 1]} style={{ position: 'absolute', top: 0.75, left: 0.75, right: 0.75, bottom: 0.75,
              borderRadius: tokens.radius.pill }} />
          <LinearGradient colors={depressed ? depth.pressedFace : depth.raisedFace}
            locations={[0, 0.5, 1]} style={{ position: 'absolute', top: depressed ? 2.5 : 1.5,
              left: depressed ? 2.5 : 1.5, right: depressed ? 2.5 : 1.5, bottom: depressed ? 2.5 : 1.5,
              borderRadius: tokens.radius.pill }} />
        </LinearGradient>
        {children}
      </Pressable>
    </Animated.View>
  </Animated.View>;
}
