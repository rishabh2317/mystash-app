import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeMode } from '@/contexts/ThemeContext';
import { softCanvasGradient } from '@/src/theme/tokens';
import type { TopBarMode } from '@/src/ui/chrome';

import { BackButton } from './BackButton';
import { BagButton } from './BagButton';

type Props = {
  mode: TopBarMode;
  title?: string;
  showBack?: boolean;
  showBag?: boolean;
  backAccessibilityLabel?: string;
  onBack?: () => void;
  /** Inserted before BagButton (Save / Share / Follow). */
  trailing?: React.ReactNode;
};

export function TopBar({
  mode,
  title,
  showBack = false,
  showBag = true,
  backAccessibilityLabel,
  onBack,
  trailing,
}: Props) {
  const insets = useSafeAreaInsets();
  const { tokens } = useThemeMode();
  const immersive = mode === 'immersive';
  const textColor = immersive ? '#F8FAFC' : tokens.color.text;

  const row = (
    <View
      pointerEvents="box-none"
      style={[
        styles.row,
        {
          paddingTop: insets.top + tokens.space.xs,
          paddingHorizontal: tokens.space.md,
          paddingBottom: tokens.space.sm,
        },
      ]}
    >
      {showBack ? (
        <BackButton mode={mode} accessibilityLabel={backAccessibilityLabel} onPress={onBack} />
      ) : (
        <View style={styles.slot} pointerEvents="none" />
      )}
      <Text
        pointerEvents="none"
        style={[styles.title, { color: textColor, fontSize: tokens.fontSize.title }]}
        numberOfLines={1}
      >
        {title ?? ''}
      </Text>
      <View style={styles.trailing} pointerEvents="box-none">
        {trailing}
        {showBag ? (
          <BagButton mode={mode} />
        ) : trailing ? null : (
          <View style={styles.slot} pointerEvents="none" />
        )}
      </View>
    </View>
  );

  if (immersive) {
    return (
      <View pointerEvents="box-none" style={styles.immersiveWrap}>
        {row}
      </View>
    );
  }

  return (
    <LinearGradient colors={[...softCanvasGradient(tokens)]} style={styles.pageWrap}>
      {row}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  immersiveWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 30,
  },
  pageWrap: {
    zIndex: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flex: 1,
    fontWeight: '800',
    textAlign: 'center',
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    minWidth: 40,
  },
  slot: {
    width: 40,
    height: 40,
  },
});
