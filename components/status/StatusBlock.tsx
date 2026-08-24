import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useThemeTokens } from '@/src/theme/useThemeTokens';
import type { StatusKind } from '@/src/ui/contracts';

type Props = {
  kind: StatusKind;
  title?: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** When true, fill available space and center content. */
  fill?: boolean;
};

/**
 * Shared status surface (UX-B STATUS_OWNERSHIP / UX-CREATE-B.8).
 * Prefer this over ad-hoc spinners and Alert-only error UX.
 */
export function StatusBlock({
  kind,
  title,
  message,
  actionLabel,
  onAction,
  fill,
}: Props) {
  const tokens = useThemeTokens();
  const accent =
    kind === 'error'
      ? tokens.color.danger
      : kind === 'success'
        ? tokens.color.success
        : tokens.color.accent;

  return (
    <View
      accessibilityRole={kind === 'error' ? 'alert' : undefined}
      style={[styles.wrap, fill ? styles.fill : null, { gap: tokens.space.sm }]}
    >
      {kind === 'loading' ? <ActivityIndicator size="large" color={accent} /> : null}
      {title ? (
        <Text
          style={{
            color: tokens.color.text,
            fontSize: tokens.fontSize.title,
            fontWeight: tokens.fontWeight.extraBold,
            textAlign: 'center',
          }}
        >
          {title}
        </Text>
      ) : null}
      <Text
        style={{
          color: tokens.color.textMuted,
          fontSize: tokens.fontSize.bodyStrong,
          lineHeight: 20,
          textAlign: 'center',
        }}
      >
        {message}
      </Text>
      {actionLabel && onAction ? (
        <TouchableOpacity
          onPress={onAction}
          accessibilityRole="button"
          style={[
            styles.action,
            {
              backgroundColor: tokens.color.borderStrong,
              borderRadius: tokens.radius.md,
              paddingHorizontal: tokens.space.md,
              paddingVertical: tokens.space.sm,
            },
          ]}
        >
          <Text
            style={{
              color: tokens.mode === 'titanium' ? tokens.color.textOnAccent : tokens.color.canvas,
              fontWeight: tokens.fontWeight.bold,
            }}
          >
            {actionLabel}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  fill: {
    flex: 1,
    justifyContent: 'center',
  },
  action: {
    marginTop: 8,
  },
});
