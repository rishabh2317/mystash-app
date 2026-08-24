import React, { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useThemeTokens } from '@/src/theme/useThemeTokens';
import type { CreatorStatus } from '@/src/types/creator';
import {
  createFieldColors,
  createPrimaryButtonStyle,
} from '@/src/ui/createChrome';
import { StatusBlock } from '@/components/status/StatusBlock';

type Props = {
  /** @deprecated Colors come from ThemeMode tokens. */
  isLight?: boolean;
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
 * Presentation-only Creator onboarding gate (UX-CREATE-B.8 tokens).
 * Parents call User APIs — this component does not.
 */
export function CreatorOnboardingPanel({
  creatorStatus,
  username,
  displayName,
  loading,
  activating,
  error,
  onActivate,
  onRetry,
}: Props) {
  const tokens = useThemeTokens();
  const [name, setName] = useState(displayName ?? '');
  const field = createFieldColors(tokens);

  if (loading) {
    return (
      <StatusBlock
        kind="loading"
        message="Checking creator status…"
        fill
      />
    );
  }

  if (!creatorStatus) {
    return (
      <StatusBlock
        kind="error"
        title="Could not load account"
        message={error ?? 'Something went wrong loading your account.'}
        actionLabel={onRetry ? 'Try again' : undefined}
        onAction={onRetry}
        fill
      />
    );
  }

  if (creatorStatus === 'SUSPENDED') {
    return (
      <View style={[styles.card, { gap: tokens.space.sm }]}>
        <Text
          style={{
            color: tokens.color.text,
            fontSize: tokens.fontSize.display,
            fontWeight: tokens.fontWeight.extraBold,
          }}
        >
          Creator suspended
        </Text>
        <Text
          style={{
            color: tokens.color.textMuted,
            fontSize: tokens.fontSize.bodyStrong,
            lineHeight: 20,
          }}
        >
          Your creator privileges are suspended. You can still browse, but you cannot create
          Collections until reinstated.
        </Text>
      </View>
    );
  }

  const isOnboarding = creatorStatus === 'ONBOARDING';
  const cta = isOnboarding ? 'Finish creator setup' : 'Become a creator';
  const primary = createPrimaryButtonStyle(tokens, { pending: !!activating });

  return (
    <View style={[styles.card, { gap: tokens.space.sm }]}>
      <Text
        style={{
          color: tokens.color.textMuted,
          fontSize: tokens.fontSize.caption,
          fontWeight: tokens.fontWeight.bold,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
        }}
      >
        {isOnboarding ? 'Creator onboarding' : 'Creator Studio'}
      </Text>
      <Text
        style={{
          color: tokens.color.text,
          fontSize: tokens.fontSize.display,
          fontWeight: tokens.fontWeight.extraBold,
        }}
      >
        {isOnboarding ? 'Activate your creator account' : 'Become a Mystash creator'}
      </Text>
      <Text
        style={{
          color: tokens.color.textMuted,
          fontSize: tokens.fontSize.bodyStrong,
          lineHeight: 20,
        }}
      >
        Collections can only be created by ACTIVE creators. This uses your existing Mystash
        account — no separate creator signup.
      </Text>

      {username ? (
        <Text
          style={{
            color: tokens.color.text,
            fontSize: tokens.fontSize.body,
            fontWeight: tokens.fontWeight.bold,
            marginTop: tokens.space.xxs,
          }}
        >
          @{username}
        </Text>
      ) : null}

      <Text
        style={{
          color: tokens.color.textMuted,
          fontSize: tokens.fontSize.caption,
          marginTop: tokens.space.xs,
        }}
      >
        Display name (optional)
      </Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Shown on your public profile"
        placeholderTextColor={field.placeholderTextColor}
        style={[
          styles.input,
          {
            color: field.color,
            borderColor: field.borderColor,
            backgroundColor: field.backgroundColor,
            borderRadius: tokens.radius.md,
            fontSize: tokens.fontSize.body,
          },
        ]}
      />

      {error ? (
        <Text style={{ color: tokens.color.danger, fontSize: 13 }}>{error}</Text>
      ) : null}

      <TouchableOpacity
        style={[
          styles.primary,
          primary,
          {
            marginTop: tokens.space.xs,
            minHeight: 48,
          },
        ]}
        disabled={!!activating}
        onPress={() => onActivate(name.trim() || null)}
      >
        {activating ? (
          <ActivityIndicator color={tokens.color.successOn} />
        ) : (
          <Text
            style={{
              color: tokens.color.successOn,
              fontWeight: tokens.fontWeight.extraBold,
              fontSize: tokens.fontSize.body,
            }}
          >
            {cta}
          </Text>
        )}
      </TouchableOpacity>

      {onRetry ? (
        <TouchableOpacity onPress={onRetry} style={styles.retry}>
          <Text style={{ color: tokens.color.textMuted, fontWeight: tokens.fontWeight.semibold }}>
            Refresh status
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: 8 },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  primary: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  retry: { alignSelf: 'center', padding: 10 },
});
