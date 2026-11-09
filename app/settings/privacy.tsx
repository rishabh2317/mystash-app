import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { outlineCardChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';

/** Navigation shell only. Approved policy text and a public URL will be added before store submission. */
export default function PrivacyScreen() {
  const { tokens } = useThemeMode();
  const insets = useSafeAreaInsets();
  return <ScrollView style={{ flex: 1, backgroundColor: tokens.color.canvas }}
    contentContainerStyle={{ padding: tokens.space.lg, paddingBottom: tokens.space.xxl + insets.bottom, gap: tokens.space.md }}>
    <Text accessibilityRole="header" style={typeStyle(tokens, 'identityTitle')}>Privacy</Text>
    <View style={[outlineCardChrome(tokens), { borderRadius: tokens.radius.lg, padding: tokens.space.lg, gap: tokens.space.sm }]}>
      <Text accessibilityRole="header" style={typeStyle(tokens, 'sectionTitle')}>Privacy Policy coming soon</Text>
      <Text style={typeStyle(tokens, 'bodyMuted')}>
        This page is a draft placeholder. It is not the Mystash Privacy Policy. Approved policy details will appear here before public release.
      </Text>
    </View>
  </ScrollView>;
}
