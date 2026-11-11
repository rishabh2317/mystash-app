import React from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';

/** Matches the existing pre-release Privacy destination; no invented legal terms. */
export default function TermsScreen() {
  const {tokens}=useThemeMode();
  return <ScrollView style={{flex:1,backgroundColor:tokens.color.canvas}} contentContainerStyle={{padding:tokens.space.lg,paddingBottom:tokens.space.xxl}}>
    <View style={{padding:tokens.space.lg,gap:tokens.space.sm,borderRadius:tokens.radius.lg,backgroundColor:tokens.color.surfaceSubtle}}>
      <Text accessibilityRole="header" style={typeStyle(tokens,'sectionTitle')}>Terms of service coming soon</Text>
      <Text style={typeStyle(tokens,'bodyMuted')}>Approved terms will appear here before public release.</Text>
    </View>
  </ScrollView>;
}
