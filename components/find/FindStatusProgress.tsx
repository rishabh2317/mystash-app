import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useThemeMode } from '@/contexts/ThemeContext';
import { usePrefersReducedMotion } from '@/src/ui/usePrefersReducedMotion';

/** An indeterminate indicator: extraction does not expose a trustworthy percentage. */
export function FindStatusProgress({ color, active, label }: { color: string; active: boolean; label: string }) {
  const { tokens } = useThemeMode();
  const reducedMotion = usePrefersReducedMotion();
  const position = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  useEffect(() => {
    position.setValue(0);
    if (!active || reducedMotion || !width) return;
    const animation = Animated.loop(Animated.timing(position, {
      toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true,
    }));
    animation.start();
    return () => animation.stop();
  }, [active, position, reducedMotion, width]);
  return <View accessibilityRole={active ? 'progressbar' : undefined} accessibilityLabel={active ? label : undefined}
    onLayout={event => setWidth(event.nativeEvent.layout.width)}
    style={{ height: 3, borderRadius: tokens.radius.pill, backgroundColor: tokens.color.divider, overflow: 'hidden' }}>
    <Animated.View style={{ height: '100%', borderRadius: tokens.radius.pill, backgroundColor: color,
      width: active ? '38%' : '100%', opacity: active ? 1 : 0.45,
      transform: [{ translateX: active && !reducedMotion ? position.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.38, width] }) : 0 }],
    }} />
  </View>;
}
