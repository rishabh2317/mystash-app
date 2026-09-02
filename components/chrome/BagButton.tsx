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
  const iconColor = immersive ? '#F8FAFC' : tokens.color.text;

  return (
    <Pressable
      onPress={() => router.push('/cart')}
      accessibilityRole="button"
      accessibilityLabel={bagButtonAccessibilityLabel(count)}
      hitSlop={hitSlopToMinTarget(40)}
      style={[
        styles.btn,
        { backgroundColor: immersive ? 'rgba(0,0,0,0.45)' : tokens.color.overlay },
      ]}
    >
      <Ionicons name="cart-outline" size={20} color={iconColor} />
      {count > 0 ? (
        <View style={[styles.badge, { backgroundColor: tokens.color.danger }]}>
          <Text style={styles.badgeText}>{formatBagBadgeText(count)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
  },
});
