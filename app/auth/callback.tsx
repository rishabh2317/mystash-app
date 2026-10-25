import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { completeAuthCallback } from '@/src/auth/authCallback';
import { AUTH_COPY } from '@/src/auth/authErrors';
import { writePasswordRecoveryPending } from '@/src/auth/pendingAuth';
import { supabaseAuthCallbackDeps } from '@/src/auth/supabaseAuthCallback';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildProfileHrefAfterAuth } from '@/src/navigation/authIntent';
import { typeStyle } from '@/src/theme/typography';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const { tokens } = useThemeMode();
  const params = useLocalSearchParams<{
    code?: string | string[];
    token_hash?: string | string[];
    type?: string | string[];
    error?: string | string[];
    error_description?: string | string[];
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
        const result = await completeAuthCallback(supabaseAuthCallbackDeps(), {
          code: first(params.code),
          token_hash: first(params.token_hash),
          type: first(params.type),
          error: first(params.error),
          error_description: first(params.error_description),
        });
        if (!active) return;
        if (result.status === 'error') {
          setCallbackError(result.message ?? AUTH_COPY.invalidLink);
          return;
        }
        if (result.status === 'password_recovery') {
          await writePasswordRecoveryPending(AsyncStorage, true);
          router.replace('/auth/reset-password' as Href);
          return;
        }
        goToProfile();
      } catch (error) {
        if (active) {
          setCallbackError(error instanceof Error ? error.message : AUTH_COPY.invalidLink);
        }
      }
    };

    void finalizeSession();

    return () => {
      active = false;
    };
  }, [
    params.catalogProductId,
    params.code,
    params.creatorId,
    params.error,
    params.error_description,
    params.intent,
    params.token_hash,
    params.type,
    params.username,
    router,
  ]);

  return (
    <View style={[styles.container, { backgroundColor: tokens.color.canvas }]}>
      <ActivityIndicator size="large" color={tokens.color.accent} />
      <Text style={[styles.text, typeStyle(tokens, 'body')]}>
        {callbackError ?? 'Finalizing sign in...'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  text: {
    fontSize: 14,
    paddingHorizontal: 24,
    textAlign: 'center',
  },
});
