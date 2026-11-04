import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useThemeMode } from '@/contexts/ThemeContext';

const SIZE = 68;

/** A self-contained navigation surface; the surrounding tab owns interaction. */
export function FindOrb() {
  const { tokens } = useThemeMode();
  return <View style={styles.shadow}>
    <View style={styles.face}>
      <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill} accessible={false}>
        <Defs>
          <RadialGradient id="findOrb" cx="35%" cy="20%" rx="80%" ry="82%">
            <Stop offset="0" stopColor="#249C8D" />
            <Stop offset="0.52" stopColor="#087C70" />
            <Stop offset="1" stopColor="#07574F" />
          </RadialGradient>
        </Defs>
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2} fill="url(#findOrb)" />
      </Svg>
      <View style={styles.content}>
        <Ionicons name="sparkles-outline" size={24} color={tokens.immersive.text} />
        <Text style={{ color: tokens.immersive.text, fontFamily: tokens.fontFamily.medium, fontSize: tokens.fontSize.micro, lineHeight: tokens.lineHeight.micro }}>Find</Text>
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  shadow: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: '#07574F', shadowColor: '#000000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 5, elevation: 4 },
  face: { flex: 1, borderRadius: SIZE / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', gap: 4 },
  content: { position: 'relative', alignItems: 'center', justifyContent: 'center', gap: 4 },
});
