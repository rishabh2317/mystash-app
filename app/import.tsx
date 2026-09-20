import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/ui/ActionButton';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { submitUserImport } from '@/src/services/userImportApi';
import { BAG_COPY } from '@/src/ui/contracts';
import {
  SHARE_IMPORT_COPY,
  extractSharedLink,
  sharedLinkMessage,
  sharedTextFromImportParams,
} from '@/src/ui/shareImport';

type Phase = 'pending' | 'acknowledged' | 'signed_out' | 'rejected';

/**
 * Share capture acknowledgement (Discover Anywhere, Phase 1).
 *
 * Reached via `mystash://import?text=…`, which the Android share target produces.
 * It confirms receipt only. Progress and products appear on Bag after processing.
 */
export default function ImportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tokens } = useThemeMode();
  const { user, loading } = useAuth();
  const params = useLocalSearchParams<{ text?: string | string[]; url?: string | string[] }>();

  const sharedText = sharedTextFromImportParams(params);
  const [phase, setPhase] = useState<Phase>('pending');
  const [message, setMessage] = useState<string | null>(null);
  const submittedRef = useRef<string | null>(null);

  const submit = useCallback(async (input: string) => {
    setPhase('pending');
    setMessage(null);
    try {
      await submitUserImport(input);
      setPhase('acknowledged');
    } catch (err) {
      setPhase('rejected');
      setMessage(err instanceof Error ? err.message : SHARE_IMPORT_COPY.genericError);
    }
  }, []);

  useEffect(() => {
    if (loading) return;

    const link = extractSharedLink(sharedText);
    if (!link.ok) {
      setPhase('rejected');
      setMessage(sharedLinkMessage(link.reason));
      return;
    }

    if (!user) {
      setPhase('signed_out');
      setMessage(SHARE_IMPORT_COPY.signedOut);
      return;
    }

    // One submission per shared payload, even if params re-render.
    if (submittedRef.current === link.rawInput) return;
    submittedRef.current = link.rawInput;
    void submit(link.rawInput);
  }, [loading, sharedText, submit, user]);

  const retry = useCallback(() => {
    const link = extractSharedLink(sharedText);
    if (!link.ok) return;
    submittedRef.current = link.rawInput;
    void submit(link.rawInput);
  }, [sharedText, submit]);

  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: tokens.color.canvas,
          paddingTop: insets.top + tokens.space.xl,
          paddingBottom: insets.bottom + tokens.space.lg,
          paddingHorizontal: tokens.space.lg,
          gap: tokens.space.md,
        },
      ]}
    >
      {phase === 'pending' ? (
        <>
          <ActivityIndicator size="large" color={tokens.color.primary} />
          <Text style={[styles.title, { color: tokens.color.text, fontSize: tokens.fontSize.body }]}>
            {SHARE_IMPORT_COPY.pending}
          </Text>
        </>
      ) : null}

      {phase === 'acknowledged' ? (
        <>
          <Ionicons name="checkmark-circle" size={48} color={tokens.color.success} />
          <Text
            style={[styles.title, { color: tokens.color.text, fontSize: tokens.fontSize.title }]}
          >
            {SHARE_IMPORT_COPY.acknowledgement}
          </Text>
          <Text style={[styles.body, { color: tokens.color.textMuted, fontSize: tokens.fontSize.body }]}>
            {SHARE_IMPORT_COPY.acknowledgementDetail}
          </Text>
          <ActionButton label={BAG_COPY.view} onPress={() => router.replace('/cart')} />
          <ActionButton
            label={SHARE_IMPORT_COPY.doneAction}
            variant="quiet"
            onPress={() => router.replace('/')}
          />
        </>
      ) : null}

      {phase === 'signed_out' ? (
        <>
          <Ionicons name="person-circle-outline" size={48} color={tokens.color.textMuted} />
          <Text
            style={[styles.title, { color: tokens.color.text, fontSize: tokens.fontSize.body }]}
          >
            {message ?? SHARE_IMPORT_COPY.signedOut}
          </Text>
          <ActionButton
            label={SHARE_IMPORT_COPY.signedOutAction}
            onPress={() => router.replace('/(tabs)/profile')}
          />
        </>
      ) : null}

      {phase === 'rejected' ? (
        <>
          <Ionicons name="alert-circle-outline" size={48} color={tokens.color.textMuted} />
          <Text
            style={[styles.title, { color: tokens.color.text, fontSize: tokens.fontSize.body }]}
          >
            {message ?? SHARE_IMPORT_COPY.genericError}
          </Text>
          <View style={[styles.actions, { gap: tokens.space.sm }]}>
            {extractSharedLink(sharedText).ok ? (
              <ActionButton label={SHARE_IMPORT_COPY.retryAction} onPress={retry} />
            ) : null}
            <ActionButton
              label={SHARE_IMPORT_COPY.doneAction}
              variant="quiet"
              onPress={() => router.replace('/')}
            />
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontWeight: '800',
    textAlign: 'center',
  },
  body: {
    fontWeight: '600',
    textAlign: 'center',
  },
  actions: {
    alignSelf: 'stretch',
  },
});
