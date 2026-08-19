import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';
import type { AddToCartOutcome } from '@/src/services/productActionOrchestration';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { BAG_COPY, controlOpacity, resolveControlPhase } from '@/src/ui/contracts';

type Props = {
  product: CatalogProductViewModel;
  /** @deprecated Colors come from ThemeMode tokens. */
  isLight?: boolean;
  variant?: 'card' | 'sheet';
  onAddToCart: (product: CatalogProductViewModel) => AddToCartOutcome | Promise<AddToCartOutcome>;
};

/**
 * User-facing Add to Bag.
 * Parent owns Cart API / auth. Control owns default → pressed → pending → success | error.
 * Success is in-control copy + haptics (toast host is UX-B.10).
 */
export function AddToCartButton({ product, variant = 'card', onAddToCart }: Props) {
  const { tokens } = useThemeMode();
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(false);
  const [pressed, setPressed] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
  };

  useEffect(() => {
    setPending(false);
    setSuccess(false);
    setError(false);
    clearTimer();
  }, [product.id, product.catalogProductId]);

  useEffect(() => () => clearTimer(), []);

  const phase = resolveControlPhase({
    pending,
    error,
    success,
    pressed: pressed && !pending && !success && !error,
  });

  const scheduleReset = () => {
    clearTimer();
    resetTimer.current = setTimeout(() => {
      setSuccess(false);
      setError(false);
      resetTimer.current = null;
    }, tokens.motion.addToBagSuccessMs);
  };

  const onPress = async () => {
    if (pending) return;
    setError(false);
    setSuccess(false);
    setPending(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      /* haptics are optional */
    }
    try {
      const outcome = await onAddToCart(product);
      setPending(false);
      if (outcome === 'login') {
        return;
      }
      if (outcome !== 'added') {
        setError(true);
        scheduleReset();
        return;
      }
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        /* haptics are optional */
      }
      setSuccess(true);
      scheduleReset();
    } catch {
      setPending(false);
      setError(true);
      scheduleReset();
    }
  };

  const isSheet = variant === 'sheet';
  const label =
    phase === 'pending'
      ? BAG_COPY.adding
      : phase === 'success'
        ? BAG_COPY.added
        : phase === 'error'
          ? BAG_COPY.addError
          : BAG_COPY.add;

  const bg =
    phase === 'success'
      ? tokens.color.success
      : isSheet && phase !== 'error'
        ? tokens.color.cta
        : 'transparent';
  const border =
    phase === 'success'
      ? tokens.color.success
      : phase === 'error'
        ? tokens.color.danger
        : isSheet
          ? tokens.color.cta
          : tokens.color.borderStrong;
  const fg =
    phase === 'success'
      ? tokens.color.successOn
      : isSheet && phase !== 'error'
        ? tokens.color.successOn
        : phase === 'error'
          ? tokens.color.danger
          : tokens.color.text;

  return (
    <Pressable
      onPress={() => {
        void onPress();
      }}
      disabled={pending}
      accessibilityRole="button"
      accessibilityLabel={
        phase === 'success'
          ? `${product.title}, ${BAG_COPY.added}`
          : `${BAG_COPY.add} ${product.title}`
      }
      accessibilityState={{ busy: pending, disabled: pending }}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        isSheet ? styles.sheetBtn : styles.cardBtn,
        {
          borderRadius: isSheet ? tokens.radius.md : 10,
          backgroundColor: bg,
          borderColor: border,
          opacity: controlOpacity(phase, tokens.motion.pressOpacity),
        },
      ]}
    >
      <View style={styles.inner}>
        {phase === 'pending' ? (
          <ActivityIndicator size="small" color={fg} />
        ) : phase === 'success' ? (
          <Ionicons name="checkmark-circle" size={isSheet ? 20 : 16} color={fg} />
        ) : null}
        <Text style={[isSheet ? styles.sheetText : styles.cardText, { color: fg }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

/** Alias for the user-facing Bag control (Cart remains the API name). */
export const AddToBagButton = AddToCartButton;

const styles = StyleSheet.create({
  cardBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
  },
  sheetBtn: {
    marginTop: 24,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardText: { fontWeight: '800', fontSize: 13 },
  sheetText: { fontWeight: '800', fontSize: 16 },
});
