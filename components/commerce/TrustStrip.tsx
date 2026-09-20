import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import {
  COLLECTION_SECTION_COPY,
  formatCollectionDate,
} from '@/src/ui/collectionSections';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';

type Props = {
  product: CatalogProductViewModel;
  /** When provided, the merchant entry opens the merchant destination. */
  onMerchantPress?: (product: CatalogProductViewModel) => void;
};

const ICON_SIZE = 14;

/**
 * Compact merchant / verification evidence, laid out as two quiet columns
 * rather than nested cards so the product card stays one decision surface.
 * Shows only catalog facts (merchant, last verified) — never warranty,
 * shipping or returns claims.
 */
export function TrustStrip({ product, onMerchantPress }: Props) {
  const { tokens } = useThemeMode();
  const merchant = product.merchant?.trim();
  const verifiedAt = formatCollectionDate(product.lastVerifiedAt);
  if (!merchant && !verifiedAt) return null;

  const labelStyle = {
    color: tokens.color.textMuted,
    fontSize: tokens.fontSize.micro,
    lineHeight: tokens.lineHeight.micro,
  };
  const valueStyle = {
    color: tokens.color.text,
    fontSize: tokens.fontSize.label,
    lineHeight: tokens.lineHeight.label,
    fontWeight: tokens.fontWeight.semibold,
  };

  return (
    <View
      style={[
        styles.row,
        {
          gap: tokens.space.md,
          paddingTop: tokens.space.sm,
          borderTopColor: tokens.color.divider,
        },
      ]}
    >
      {merchant ? (
        <Pressable
          onPress={onMerchantPress ? () => onMerchantPress(product) : undefined}
          disabled={!onMerchantPress}
          accessibilityRole={onMerchantPress ? 'link' : 'text'}
          accessibilityLabel={`${COLLECTION_SECTION_COPY.soldBy} ${merchant}`}
          style={({ pressed }) => [
            styles.entry,
            {
              gap: tokens.space.xs,
              opacity: controlOpacity(
                resolveControlPhase({ pressed: pressed && Boolean(onMerchantPress) }),
                tokens.motion.pressOpacity,
              ),
            },
          ]}
        >
          <Ionicons name="storefront-outline" size={ICON_SIZE} color={tokens.color.textMuted} />
          <View style={styles.copy}>
            <Text style={labelStyle}>{COLLECTION_SECTION_COPY.soldBy}</Text>
            <Text style={valueStyle} numberOfLines={1}>
              {merchant}
            </Text>
          </View>
          {onMerchantPress ? (
            <Ionicons name="open-outline" size={12} color={tokens.color.textMuted} />
          ) : null}
        </Pressable>
      ) : null}
      {verifiedAt ? (
        <View
          style={[styles.entry, { gap: tokens.space.xs }]}
          accessibilityRole="text"
          accessibilityLabel={`${COLLECTION_SECTION_COPY.lastVerified} ${verifiedAt}`}
        >
          <Ionicons
            name="shield-checkmark-outline"
            size={ICON_SIZE}
            color={tokens.color.textMuted}
          />
          <View style={styles.copy}>
            <Text style={labelStyle}>{COLLECTION_SECTION_COPY.lastVerified}</Text>
            <Text style={valueStyle} numberOfLines={1}>
              {verifiedAt}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  entry: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
});
