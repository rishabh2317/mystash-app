import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { CreatorOnboardingPanel } from '@/components/creator/CreatorOnboardingPanel';
import { useThemeMode } from '@/contexts/ThemeContext';

/** Settings entry for the canonical two-step creator onboarding flow. */
export default function CreatorOnboardingScreen() {
  const router = useRouter();
  const { tokens } = useThemeMode();

  return (
    <View style={[styles.screen, { backgroundColor: tokens.color.canvas }]}>
      <CreatorOnboardingPanel
        onActivated={() => router.replace('/(tabs)/create')}
        onAlreadyActive={() => router.replace('/(tabs)/create')}
        onSuspended={() => router.replace('/settings')}
        onCancel={() => router.replace('/settings')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
