import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * Web popup target so `maybeCompleteAuthSession` can match the return URL.
 * Native builds should not land here: `app/+native-intent.ts` keeps the
 * `mystash://connected-accounts/callback` hop out of the router. If a native
 * navigation still reaches this screen, leave immediately for Settings.
 */
export default function ConnectedAccountCallbackScreen() {
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS === 'web') return;
    router.replace('/settings');
  }, [router]);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>YouTube linking finished</Text>
      <Text style={styles.body}>You can return to Mystash.</Text>
      <Pressable onPress={() => router.replace('/settings')} style={styles.button}>
        <Text style={styles.buttonText}>Back to Settings</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  body: { color: '#ccc', fontSize: 14, textAlign: 'center' },
  button: { marginTop: 8, paddingHorizontal: 16, paddingVertical: 10 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
