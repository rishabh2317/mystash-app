import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { useCartOptional } from '@/contexts/CartContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import {
  bagBadgeCount,
  bagButtonAccessibilityLabel,
  formatBagBadgeText,
  type TopBarMode,
} from '@/src/ui/chrome';
import { hitSlopToMinTarget } from '@/src/ui/feedA11y';

type Props = {
  mode?: TopBarMode;
};

/** Universal commerce entry. Navigates to existing `/cart`. */
export function BagButton({ mode = 'page' }: Props) {
  const router = useRouter();
  const { tokens } = useThemeMode();
  const { user } = useAuth();
  const cart = useCartOptional();
  const count = bagBadgeCount(Boolean(user), cart?.itemCount ?? 0);
  const immersive = mode === 'immersive';
  const iconColor = immersive ? tokens.immersive.icon : tokens.color.icon;

  return (
    <Pressable
      onPress={() => router.push('/cart')}
      accessibilityRole="button"
      accessibilityLabel={bagButtonAccessibilityLabel(count)}
      hitSlop={hitSlopToMinTarget(40)}
      style={[
        styles.btn,
        {
          backgroundColor: immersive ? tokens.immersive.controlStrong : tokens.color.overlay,
          borderRadius: tokens.radius.pill,
        },
      ]}
    >
      <Ionicons name="cart-outline" size={20} color={iconColor} />
      {count > 0 ? (
        <View
          style={[
            styles.badge,
            { backgroundColor: tokens.color.danger, borderRadius: tokens.radius.pill },
          ]}
        >
          <Text style={[styles.badgeText, { color: tokens.color.dangerOn }]}>
            {formatBagBadgeText(count)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
});
