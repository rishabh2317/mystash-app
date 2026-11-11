import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { ActionButton } from '@/components/ui/ActionButton';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { typeStyle } from '@/src/theme/typography';
import { apiFailure } from '@/src/ui/apiFailure';

type Props = {
  error?: unknown;
  title?: string;
  message?: string;
  onRetry?: () => void;
  actionLabel?: string;
  pending?: boolean;
  variant?: 'page' | 'inline' | 'immersive';
  fill?: boolean;
};

/** One calm, accessible failure surface. Inline errors never replace loaded content. */
export function FailureState({ error, title, message, onRetry, actionLabel = 'Try again', pending = false, variant = 'page', fill }: Props) {
  const tokens = useThemeTokens(), failure = apiFailure(error ?? message);
  const inline = variant === 'inline', immersive = variant === 'immersive';
  const known = failure.kind !== 'unknown';
  const standardTitle = ['connection', 'timeout', 'service', 'rateLimit'].includes(failure.kind);
  const text = immersive ? tokens.immersive.text : tokens.color.text;
  const muted = immersive ? tokens.immersive.textMuted : tokens.color.textMuted;
  const icon = failure.kind === 'connection' ? 'cloud-offline-outline' : failure.kind === 'session' || failure.kind === 'permission' ? 'lock-closed-outline' : failure.kind === 'timeout' || failure.kind === 'rateLimit' ? 'time-outline' : 'refresh-outline';
  return <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ ...(fill ? { flex: 1, justifyContent: 'center' as const } : {}), padding: inline ? tokens.space.sm : tokens.space.lg, gap: tokens.space.sm, alignItems: inline ? 'stretch' : 'center', ...(inline ? { borderWidth: tokens.stroke.thin, borderColor: tokens.color.border, borderRadius: tokens.radius.lg, backgroundColor: tokens.color.surfaceSubtle } : {}) }}>
    <View style={{ flexDirection: inline ? 'row' : 'column', alignItems: inline ? 'flex-start' : 'center', gap: tokens.space.sm, width: '100%', maxWidth: 420, alignSelf: 'center' }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ padding: tokens.space.sm, borderRadius: tokens.radius.pill, backgroundColor: immersive ? tokens.immersive.control : tokens.color.surfaceSubtle }}><Ionicons name={icon} size={24} color={muted} /></View>
      <View style={{ flexShrink: 1, flex: inline ? 1 : undefined, width: inline ? undefined : '100%', minWidth: 0, gap: tokens.space.xs }}>
        <Text accessibilityRole="header" style={[typeStyle(tokens, 'tileTitle'), { color: text, textAlign: inline ? 'left' : 'center' }]}>{standardTitle ? failure.title : title ?? failure.title}</Text>
        <Text style={[typeStyle(tokens, 'bodyMuted'), { color: muted, textAlign: inline ? 'left' : 'center' }]}>{known ? failure.message : message ? apiFailure(message).message : failure.message}</Text>
      </View>
    </View>
    {onRetry ? <View style={{ width: '100%', maxWidth: 280, alignSelf: inline ? 'flex-start' : 'center' }}><ActionButton label={actionLabel} onPress={onRetry} pending={pending} variant="secondary" wrapLabel minTouchHeight={48} /></View> : null}
  </View>;
}
