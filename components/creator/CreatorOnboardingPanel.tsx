import React, { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { CreatorStatus } from '@/src/types/creator';

type Props = {
  isLight: boolean;
  creatorStatus: CreatorStatus | null;
  username: string | null;
  displayName: string | null;
  loading?: boolean;
  activating?: boolean;
  error?: string | null;
  onActivate: (displayName: string | null) => void;
  onRetry?: () => void;
};

/**
 * Presentation-only Creator onboarding gate.
 * Parents call User APIs (start/complete) — this component does not.
 */
export function CreatorOnboardingPanel({
  isLight,
  creatorStatus,
  username,
  displayName,
  loading,
  activating,
  error,
  onActivate,
  onRetry,
}: Props) {
  const [name, setName] = useState(displayName ?? '');
  const text = isLight ? '#1A1A1B' : '#F8FAFC';
  const muted = isLight ? '#4E5257' : '#AEB8C5';

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={isLight ? '#00AFC0' : '#A855F7'} />
        <Text style={[styles.sub, { color: muted }]}>Checking creator status…</Text>
      </View>
    );
  }

  if (!creatorStatus) {
    return (
      <View style={styles.card}>
        <Text style={[styles.title, { color: text }]}>Could not load account</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {onRetry ? (
          <TouchableOpacity onPress={onRetry} style={styles.retry}>
            <Text style={{ color: muted, fontWeight: '600' }}>Try again</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  if (creatorStatus === 'SUSPENDED') {
    return (
      <View style={styles.card}>
        <Text style={[styles.title, { color: text }]}>Creator suspended</Text>
        <Text style={[styles.sub, { color: muted }]}>
          Your creator privileges are suspended. You can still browse, but you cannot create
          Collections until reinstated.
        </Text>
      </View>
    );
  }

  const isOnboarding = creatorStatus === 'ONBOARDING';
  const cta = isOnboarding ? 'Finish creator setup' : 'Become a creator';

  return (
    <View style={styles.card}>
      <Text style={[styles.eyebrow, { color: muted }]}>
        {isOnboarding ? 'Creator onboarding' : 'Start creating'}
      </Text>
      <Text style={[styles.title, { color: text }]}>
        {isOnboarding ? 'Activate your creator account' : 'Become a Mystash creator'}
      </Text>
      <Text style={[styles.sub, { color: muted }]}>
        Collections can only be created by ACTIVE creators. This uses your existing Mystash
        account — no separate creator signup.
      </Text>

      {username ? (
        <Text style={[styles.handle, { color: text }]}>@{username}</Text>
      ) : null}

      <Text style={[styles.label, { color: muted }]}>Display name (optional)</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Shown on your public profile"
        placeholderTextColor={isLight ? '#94A3B8' : '#64748B'}
        style={[
          styles.input,
          {
            color: text,
            borderColor: isLight ? 'rgba(148,163,184,0.45)' : 'rgba(148,163,184,0.35)',
            backgroundColor: isLight ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.08)',
          },
        ]}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.primary, { opacity: activating ? 0.6 : 1 }]}
        disabled={!!activating}
        onPress={() => onActivate(name.trim() || null)}
      >
        {activating ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryText}>{cta}</Text>
        )}
      </TouchableOpacity>

      {onRetry ? (
        <TouchableOpacity onPress={onRetry} style={styles.retry}>
          <Text style={{ color: muted, fontWeight: '600' }}>Refresh status</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: 'center', gap: 12, paddingVertical: 40 },
  card: { gap: 10, paddingVertical: 8 },
  eyebrow: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { fontSize: 14, lineHeight: 20 },
  handle: { fontSize: 15, fontWeight: '700', marginTop: 4 },
  label: { fontSize: 12, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  primary: {
    marginTop: 8,
    backgroundColor: '#0F766E',
    borderRadius: 14,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  error: { color: '#EF4444', fontSize: 13 },
  retry: { alignSelf: 'center', padding: 10 },
});
