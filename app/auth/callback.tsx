import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { supabase } from '@/src/services/supabase';

export default function AuthCallbackScreen() {
  const router = useRouter();

  useEffect(() => {
    let active = true;

    const finalizeSession = async () => {
      try {
        // In most cases openAuthSessionAsync + onAuthStateChange already handles session.
        // This is a safety pass for callback-based flows.
        const { data } = await supabase.auth.getSession();
        if (!active) return;

        if (data.session) {
          router.replace('/(tabs)/profile');
          return;
        }

        // If session is not available yet, short delay then route back anyway.
        setTimeout(() => {
          if (active) router.replace('/(tabs)/profile');
        }, 350);
      } catch {
        if (active) router.replace('/(tabs)/profile');
      }
    };

    finalizeSession();

    return () => {
      active = false;
    };
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#A855F7" />
      <Text style={styles.text}>Finalizing sign in...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#020408',
    gap: 12,
  },
  text: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
  },
});

