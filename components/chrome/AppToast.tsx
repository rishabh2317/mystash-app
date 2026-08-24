import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeMode } from '@/contexts/ThemeContext';
import type { ToastTone } from '@/src/ui/contracts';

type Props = {
  tone: ToastTone;
  title: string;
  onDismiss?: () => void;
};

/**
 * Minimal toast rendered into FeedbackHost (UX-CREATE-B.6 / UX-B toast contract).
 * Screens call useAppToast(); they must not invent a parallel toast host.
 */
export function AppToast({ tone, title, onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  const { tokens } = useThemeMode();
  const bg =
    tone === 'success'
      ? tokens.color.success
      : tone === 'error'
        ? tokens.mode === 'titanium'
          ? tokens.color.danger
          : '#7F1D1D'
        : tokens.color.surfaceRaised;
  const fg = tone === 'info' ? tokens.color.text : '#FFFFFF';

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { paddingTop: Math.max(insets.top, 12) + 8 }]}
    >
      <Pressable
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        onPress={onDismiss}
        style={[
          styles.toast,
          {
            backgroundColor: bg,
            borderColor: tokens.color.border,
          },
        ]}
      >
        <Text style={[styles.title, { color: fg }]} numberOfLines={3}>
          {title}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  toast: {
    maxWidth: 420,
    width: '100%',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
    textAlign: 'center',
  },
});
