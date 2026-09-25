import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import type { TopBarMode } from '@/src/ui/chrome';

import { BackButton } from './BackButton';

type Props = {
  mode: TopBarMode;
  title?: string;
  showBack?: boolean;
  /**
   * @deprecated Stash lives in the tab bar. Ignored — kept so call sites stay stable.
   */
  showBag?: boolean;
  backAccessibilityLabel?: string;
  onBack?: () => void;
  /** Trailing actions (Save / Share / overflow). */
  trailing?: React.ReactNode;
};

/**
 * Canonical page / immersive header.
 * Page titles are left-aligned; with a back control the title sits beside it.
 * Page chrome uses canvasSoft so TopBar + tab bar + scaffold read as one surface.
 * Stash entry is the tab bar only — no TopBar bag control.
 */
export function TopBar({
  mode,
  title,
  showBack = false,
  backAccessibilityLabel,
  onBack,
  trailing,
}: Props) {
  const insets = useSafeAreaInsets();
  const { tokens } = useThemeMode();
  const immersive = mode === 'immersive';
  const textColor = immersive ? tokens.immersive.text : tokens.color.text;

  const row = (
    <View
      pointerEvents="box-none"
      style={[
        styles.row,
        {
          paddingTop: insets.top + tokens.space.xs,
          paddingHorizontal: tokens.space.md,
          paddingBottom: tokens.space.sm,
          gap: tokens.space.xs,
        },
      ]}
    >
      {showBack ? (
        <BackButton mode={mode} accessibilityLabel={backAccessibilityLabel} onPress={onBack} />
      ) : null}
      <Text
        pointerEvents="none"
        style={[styles.title, typeStyle(tokens, 'chromeTitle'), { color: textColor }]}
        numberOfLines={1}
      >
        {title ?? ''}
      </Text>
      <View style={styles.trailing} pointerEvents="box-none">
        {trailing ?? (showBack ? null : <View style={styles.slot} pointerEvents="none" />)}
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
    <View style={[styles.pageWrap, { backgroundColor: tokens.color.canvasSoft }]}>{row}</View>
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
  },
  title: {
    flex: 1,
    textAlign: 'left',
    minWidth: 0,
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    flexShrink: 0,
    minHeight: 40,
  },
  slot: {
    width: 40,
    height: 40,
  },
});
