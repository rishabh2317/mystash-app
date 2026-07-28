import React from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Extrapolate,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useThemeMode } from '@/contexts/ThemeContext';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const HEADER_HEIGHT = SCREEN_HEIGHT * 0.10;

function LedFlowTrack({
  lightOpacity,
  darkOpacity,
}: {
  lightOpacity: any;
  darkOpacity: any;
}) {
  const pulse = useSharedValue(0);

  React.useEffect(() => {
    pulse.value = 0;
    pulse.value = withRepeat(withTiming(1, { duration: 1600 }), -1, true);
  }, [pulse]);

  const titaniumShineStyle = useAnimatedStyle(() => ({
    opacity: lightOpacity.value * interpolate(pulse.value, [0, 1], [0.45, 0.95], Extrapolate.CLAMP),
    transform: [{ scaleX: interpolate(pulse.value, [0, 1], [0.985, 1], Extrapolate.CLAMP) }],
  }));

  const nebulaShineStyle = useAnimatedStyle(() => ({
    opacity: darkOpacity.value * interpolate(pulse.value, [0, 1], [0.35, 0.9], Extrapolate.CLAMP),
    transform: [{ scaleX: interpolate(pulse.value, [0, 1], [0.98, 1], Extrapolate.CLAMP) }],
  }));

  return (
    <View style={styles.ledOuter}>
      <View style={styles.ledBase} pointerEvents="none" />

      <Animated.View
        style={[styles.fullLengthLed, titaniumShineStyle, { shadowColor: '#00F2FF', shadowRadius: 8, shadowOpacity: 0.6 }]}
        pointerEvents="none"
      >
        <LinearGradient
          colors={['#00F2FF', '#22D3EE', '#60A5FA', '#00F2FF']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <Animated.View
        style={[styles.fullLengthLed, nebulaShineStyle, { shadowColor: '#A855F7', shadowRadius: 15, shadowOpacity: 0.65 }]}
        pointerEvents="none"
      >
        <LinearGradient
          colors={['#A855F7', '#7C3AED', '#22D3EE', '#A855F7']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

export default function Header({ title = 'MYSTASH' }: { title?: string }) {
  const { lightOpacity, darkOpacity } = useThemeMode();

  const brandStyle = useAnimatedStyle(() => {
    const color = interpolateColor(lightOpacity.value, [0, 1], ['#F8FAFC', '#1A1A1B']);
    const shadowColor = interpolateColor(
      lightOpacity.value,
      [0, 1],
      ['rgba(168,85,247,0.55)', 'rgba(0,0,0,0.0)'],
    );
    return {
      color,
      textShadowColor: shadowColor,
      textShadowRadius: interpolate(lightOpacity.value, [0, 1], [10, 0], Extrapolate.CLAMP),
      textShadowOffset: { width: 0, height: 2 },
    } as any;
  });

  return (
    <View style={[styles.container, { height: HEADER_HEIGHT }]}>
      {/* Background crossfade */}
      <Animated.View style={[styles.titaniumBg, { opacity: lightOpacity }]} pointerEvents="none">
        <LinearGradient
          colors={['#FDFDFD', '#E8E8E8', '#D1D1D1']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
        />
      </Animated.View>

      <Animated.View style={[styles.nebulaBg, { opacity: darkOpacity }]} pointerEvents="none">
        <LinearGradient
          colors={['#0D111F', '#020408']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
        <LinearGradient
          colors={['rgba(45,58,104,0.55)', 'rgba(13,17,31,0.0)']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
      </Animated.View>

      {/* Inner edge LED track (header meets video at its bottom edge) */}
      <View style={styles.bottomEdge}>
        <LedFlowTrack lightOpacity={lightOpacity} darkOpacity={darkOpacity} />
      </View>

      {/* Chamfer / specular highlight */}
      <View style={styles.headerBottomSpecular} pointerEvents="none" />

      {/* Foreground content */}
      <View style={styles.content} pointerEvents="box-none">
        <Animated.Text style={[styles.brand, brandStyle]} numberOfLines={1}>
          {title}
        </Animated.Text>
        <View style={styles.rightSpacer} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 15,
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    fontSize: 20,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  titaniumBg: {
    ...StyleSheet.absoluteFillObject,
  },
  nebulaBg: {
    ...StyleSheet.absoluteFillObject,
  },
  headerBottomSpecular: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
    backgroundColor: '#FFFFFF',
    opacity: 0.9,
  },
  bottomEdge: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 1,
    height: 2,
  },
  ledOuter: {
    flex: 1,
    justifyContent: 'center',
  },
  ledBase: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(176,181,187,0.85)',
    opacity: 0.7,
  },
  fullLengthLed: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 0,
    overflow: 'hidden',
  },
  rightSpacer: {
    width: 56,
  },
});

