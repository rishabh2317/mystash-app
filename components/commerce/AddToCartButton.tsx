import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useCartOptional } from '@/contexts/CartContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import type { AddToCartOutcome } from '@/src/services/productActionOrchestration';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { catalogProductInBag } from '@/src/ui/bagMembership';
import { BAG_COPY, controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { hitSlopToMinTarget } from '@/src/ui/feedA11y';

type Props = {
  product: CatalogProductViewModel;
  /** @deprecated Colors come from ThemeMode tokens. */
  isLight?: boolean;
  /**
   * `icon` is the same state machine rendered as a round icon-only control.
   * It is laid directly on product media, so it uses the on-media treatment.
   * `quiet` is the same control at secondary emphasis, for cards where a
   * primary CTA already owns the decision.
   */
  variant?: 'card' | 'sheet' | 'icon' | 'quiet';
  onAddToCart: (product: CatalogProductViewModel) => AddToCartOutcome | Promise<AddToCartOutcome>;
};

const ICON_BUTTON_SIZE = 32;

/**
 * User-facing Add to Bag / remove from Stash.
 * Parent owns Cart API / auth. Not in Stash → add icon. In Stash → trash glyph
 * on the same immersive chip family as add-to-bag.
 */
export function AddToCartButton({ product, variant = 'card', onAddToCart }: Props) {
  const { tokens } = useThemeMode();
  const cart = useCartOptional();
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(false);
  const [pressed, setPressed] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inBag = catalogProductInBag(cart?.items ?? [], product.catalogProductId);
  const added = inBag || success;

  const clearTimer = () => {
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
  };

  useEffect(() => {
    setPending(false);
    setError(false);
    clearTimer();
  }, [product.id, product.catalogProductId]);

  useEffect(() => {
    setSuccess(catalogProductInBag(cart?.items ?? [], product.catalogProductId));
  }, [cart?.items, product.catalogProductId]);

  useEffect(() => () => clearTimer(), []);

  const phase = resolveControlPhase({
    pending,
    error,
    success: added && !error,
    pressed: pressed && !pending && !error,
  });

  const scheduleReset = () => {
    clearTimer();
    resetTimer.current = setTimeout(() => {
      setSuccess(false);
      setError(false);
      resetTimer.current = null;
    }, tokens.motion.addToBagSuccessMs);
  };

  const runToggle = async (removing: boolean) => {
    if (pending) return;
    setError(false);
    if (!removing) setSuccess(false);
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
      if (outcome === 'removed') {
        setSuccess(false);
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
    } catch {
      setPending(false);
      setError(true);
      scheduleReset();
    }
  };

  const onPress = () => {
    if (pending) return;
    if (added) {
      Alert.alert(BAG_COPY.removeFromBag, `Remove ${product.title} from your Stash?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void runToggle(true);
          },
        },
      ]);
      return;
    }
    void runToggle(false);
  };

  const isSheet = variant === 'sheet';
  const isIcon = variant === 'icon';
  const isQuiet = variant === 'quiet';
  const label =
    phase === 'pending'
      ? added
        ? BAG_COPY.removeFromBag
        : BAG_COPY.adding
      : phase === 'error'
        ? added
          ? BAG_COPY.removeError
          : BAG_COPY.addError
        : added
          ? BAG_COPY.removeFromBag
          : BAG_COPY.add;

  // In-Stash shares the add-to-bag icon chip family; only the glyph changes.
  const inStashVisual = added && !error;

  const bg = inStashVisual
    ? 'transparent'
    : isQuiet
      ? tokens.color.surfaceSubtle
      : isSheet
        ? tokens.color.cta
        : 'transparent';
  const border = error
    ? tokens.color.danger
    : inStashVisual
      ? 'transparent'
      : isQuiet
        ? tokens.color.border
        : isSheet
          ? tokens.color.cta
          : tokens.color.borderStrong;
  const fg = error
    ? tokens.color.danger
    : inStashVisual
      ? tokens.color.text
      : isQuiet
        ? tokens.color.text
        : isSheet
          ? tokens.color.successOn
          : tokens.color.text;

  if (isIcon) {
    return (
      <Pressable
        onPress={onPress}
        disabled={pending}
        accessibilityRole="button"
        accessibilityLabel={
          added
            ? `${BAG_COPY.removeFromBag} ${product.title}`
            : `${BAG_COPY.add} ${product.title}`
        }
        accessibilityState={{ busy: pending, disabled: pending, selected: added }}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        hitSlop={hitSlopToMinTarget(ICON_BUTTON_SIZE)}
        style={[
          styles.iconBtn,
          {
            borderRadius: tokens.radius.pill,
            backgroundColor: tokens.immersive.controlStrong,
            borderColor: tokens.immersive.border,
            opacity: controlOpacity(phase, tokens.motion.pressOpacity),
          },
        ]}
      >
        {pending ? (
          <ActivityIndicator size="small" color={tokens.immersive.icon} />
        ) : (
          <Ionicons
            name={added ? 'trash-outline' : 'bag-add-outline'}
            size={15}
            color={tokens.immersive.icon}
          />
        )}
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={pending}
      accessibilityRole="button"
      accessibilityLabel={
        added
          ? `${BAG_COPY.removeFromBag} ${product.title}`
          : `${BAG_COPY.add} ${product.title}`
      }
      accessibilityState={{ busy: pending, disabled: pending, selected: added }}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        isSheet ? styles.sheetBtn : styles.cardBtn,
        {
          borderRadius: isSheet || isQuiet ? tokens.radius.md : 10,
          backgroundColor: bg,
          borderColor: border,
          borderWidth: isQuiet || inStashVisual ? StyleSheet.hairlineWidth : 1,
          paddingVertical: isQuiet ? tokens.space.sm : undefined,
          paddingHorizontal: isQuiet ? tokens.space.sm : undefined,
          opacity: controlOpacity(phase, tokens.motion.pressOpacity),
        },
      ]}
    >
      <View style={styles.inner}>
        {phase === 'pending' ? (
          <ActivityIndicator size="small" color={fg} />
        ) : (
          <Ionicons
            name={added ? 'trash-outline' : 'bag-add-outline'}
            size={isSheet ? 18 : 15}
            color={fg}
          />
        )}
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
  iconBtn: {
    width: ICON_BUTTON_SIZE,
    height: ICON_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardText: { fontWeight: '800', fontSize: 13 },
  sheetText: { fontWeight: '800', fontSize: 16 },
});
