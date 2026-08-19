import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { buildProfileHrefAfterAuth } from '@/src/navigation/authIntent';
import { supabase } from '@/src/services/supabase';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    code?: string | string[];
    access_token?: string | string[];
    refresh_token?: string | string[];
    error?: string | string[];
    error_description?: string | string[];
    /** Same route-level intent keys as Profile (OD-12), when present on redirectTo. */
    intent?: string | string[];
    catalogProductId?: string | string[];
    creatorId?: string | string[];
    username?: string | string[];
  }>();
  const [callbackError, setCallbackError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const first = (value: string | string[] | undefined) =>
      Array.isArray(value) ? value[0] : value;

    const goToProfile = () => {
      // Validate intent; malformed / unsupported → plain Profile (no action).
      router.replace(
        buildProfileHrefAfterAuth({
          intent: params.intent,
          catalogProductId: params.catalogProductId,
          creatorId: params.creatorId,
          username: params.username,
        }),
      );
    };

    const finalizeSession = async () => {
      try {
        const oauthError = first(params.error_description) ?? first(params.error);
        if (oauthError) {
          if (active) setCallbackError(oauthError);
          return;
        }

        // openAuthSessionAsync usually exchanges the code in AuthContext.
        // Direct deep-link callbacks land here, so complete PKCE as a fallback.
        let { data } = await supabase.auth.getSession();
        if (!active) return;

        if (data.session) {
          goToProfile();
          return;
        }

        const code = first(params.code);
        if (code) {
          const exchanged = await supabase.auth.exchangeCodeForSession(code);
          if (exchanged.error) throw exchanged.error;
          data = exchanged.data;
        } else {
          const accessToken = first(params.access_token);
          const refreshToken = first(params.refresh_token);
          if (accessToken && refreshToken) {
            const restored = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (restored.error) throw restored.error;
            data = restored.data;
          }
        }

        if (!active) return;
        if (data.session) {
          goToProfile();
          return;
        }
        setCallbackError('Google sign in returned without a session. Please try again.');
      } catch (error) {
        if (active) {
          setCallbackError(error instanceof Error ? error.message : 'Could not complete Google sign in.');
        }
      }
    };

    finalizeSession();

    return () => {
      active = false;
    };
  }, [
    params.access_token,
    params.catalogProductId,
    params.code,
    params.error,
    params.error_description,
    params.intent,
    params.refresh_token,
    router,
  ]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#A855F7" />
      <Text style={styles.text}>{callbackError ?? 'Finalizing sign in...'}</Text>
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
