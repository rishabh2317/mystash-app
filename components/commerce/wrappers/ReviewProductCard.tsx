import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { CREATE_COPY } from '@/src/ui/createCopy';
import { ProductCard } from '../ProductCard';

type Props = {
  product: CatalogProductViewModel;
  /** @deprecated Colors come from ThemeMode tokens. */
  isLight?: boolean;
  included: boolean;
  onToggleInclude: (included: boolean) => void;
  onOpenDetails: (product: CatalogProductViewModel) => void;
  /** Optional AI confidence 0–1 shown only on Review. */
  confidence?: number | null;
  extractionHint?: string | null;
};

/**
 * Review-only wrapper: generic ProductCard + Include toggle / confidence.
 * Does not put Buy or Include inside ProductCard.
 */
export function ReviewProductCard({
  product,
  included,
  onToggleInclude,
  onOpenDetails,
  confidence,
  extractionHint,
}: Props) {
  const tokens = useThemeTokens();

  return (
    <View style={styles.wrap}>
      <View style={styles.cardClip}>
        <ProductCard product={product} onPress={onOpenDetails} />
      </View>
      <View
        style={[
          styles.footer,
          {
            borderColor: tokens.color.border,
            backgroundColor: tokens.color.surfaceRaised,
            borderBottomLeftRadius: tokens.radius.lg,
            borderBottomRightRadius: tokens.radius.lg,
            paddingHorizontal: tokens.space.sm,
            paddingVertical: tokens.space.xs,
            gap: tokens.space.xs,
          },
        ]}
      >
        {(confidence != null && confidence > 0) || extractionHint ? (
          <Text
            style={{
              flex: 1,
              fontSize: tokens.fontSize.caption,
              fontWeight: '500',
              color: tokens.color.textMuted,
            }}
            numberOfLines={1}
          >
            {extractionHint
              ? extractionHint
              : confidence != null
                ? `AI confidence ${Math.round(confidence * 100)}%`
                : ''}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <View style={styles.includeRow}>
          <Text
            style={{
              color: tokens.color.text,
              fontSize: 13,
              fontWeight: tokens.fontWeight.semibold,
            }}
          >
            {CREATE_COPY.editorIncludeLabel}
          </Text>
          <Switch value={included} onValueChange={onToggleInclude} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 0 },
  cardClip: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  footer: {
    marginTop: -1,
    borderWidth: 1,
    borderTopWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  includeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
