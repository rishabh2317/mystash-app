import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { pageCanvasGradient } from '@/src/theme/tokens';
import { useThemeTokens } from '@/src/theme/useThemeTokens';

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Match Search/Collection page canvas (UX-CREATE-B.8). */
  testID?: string;
};

/**
 * Canonical Create-stack page shell: Titanium/Nebula page canvas + children.
 * TopBar remains the shared chrome header from the Create stack layout.
 */
export function CreateScreenShell({ children, style, testID }: Props) {
  const tokens = useThemeTokens();
  return (
    <View style={[styles.screen, style]} testID={testID}>
      <LinearGradient colors={[...pageCanvasGradient(tokens)]} style={StyleSheet.absoluteFill} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
