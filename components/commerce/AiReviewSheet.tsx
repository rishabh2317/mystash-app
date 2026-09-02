import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeMode } from '@/contexts/ThemeContext';
import type { CatalogProductViewModel } from '@/src/types/catalogProduct';
import { fetchProductAiReview } from '@/src/services/productAiReviewApi';
import type { ProductAiReviewResult } from '@/src/types/productAiReview';

type Props = {
  visible: boolean;
  product: CatalogProductViewModel | null;
  onClose: () => void;
};

export function AiReviewSheet({ visible, product, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { tokens } = useThemeMode();
  const [result, setResult] = useState<ProductAiReviewResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !product?.catalogProductId) {
      setResult(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setResult(null);
    void fetchProductAiReview(product.catalogProductId)
      .then((next) => {
        if (!cancelled) setResult(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, product?.catalogProductId]);

  if (!product) return null;

  const title = product.title?.trim() || 'Product';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: tokens.overlay.scrim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss" />
        <View
          style={[
            styles.sheet,
            {
              paddingBottom: Math.max(insets.bottom, 12),
              backgroundColor: tokens.color.canvasSoft,
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: tokens.color.textMuted }]} />
          <Text style={[styles.heading, { color: tokens.color.text }]}>AI Review</Text>
          <Text style={[styles.subtitle, { color: tokens.color.textMuted }]} numberOfLines={2}>
            {title}
          </Text>

          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={tokens.color.text} />
              <Text style={[styles.status, { color: tokens.color.textMuted }]}>
                Loading review summary…
              </Text>
            </View>
          ) : result?.status === 'generating' ? (
            <View style={styles.centered}>
              <ActivityIndicator color={tokens.color.text} />
              <Text style={[styles.status, { color: tokens.color.textMuted }]}>{result.message}</Text>
            </View>
          ) : result?.status === 'available' ? (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
              {result.summary.overview ? (
                <Text style={[styles.overview, { color: tokens.color.text }]}>{result.summary.overview}</Text>
              ) : null}
              {result.summary.pros.length > 0 ? (
                <View style={styles.block}>
                  <Text style={[styles.blockTitle, { color: tokens.color.text }]}>Pros</Text>
                  {result.summary.pros.map((item) => (
                    <Text key={`pro-${item}`} style={[styles.bullet, { color: tokens.color.text }]}>
                      · {item}
                    </Text>
                  ))}
                </View>
              ) : null}
              {result.summary.cons.length > 0 ? (
                <View style={styles.block}>
                  <Text style={[styles.blockTitle, { color: tokens.color.text }]}>Cons</Text>
                  {result.summary.cons.map((item) => (
                    <Text key={`con-${item}`} style={[styles.bullet, { color: tokens.color.text }]}>
                      · {item}
                    </Text>
                  ))}
                </View>
              ) : null}
              {result.summary.sources.length > 0 ? (
                <View style={styles.block}>
                  <Text style={[styles.blockTitle, { color: tokens.color.text }]}>Sources</Text>
                  {result.summary.sources.map((source) => (
                    <Pressable
                      key={source.url}
                      onPress={() => void Linking.openURL(source.url)}
                      accessibilityRole="link"
                      accessibilityLabel={`Open review source ${source.name}`}
                      style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}
                    >
                      <Text style={[styles.sourceLink, { color: tokens.color.accent }]}>
                        {source.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </ScrollView>
          ) : (
            <View style={styles.centered}>
              <Text style={[styles.status, { color: tokens.color.textMuted }]}>
                {result?.status === 'unavailable'
                  ? result.message
                  : 'AI Review summaries are not available for this product yet.'}
              </Text>
            </View>
          )}

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close AI Review"
            style={[styles.closeBtn, { borderColor: tokens.color.border }]}
          >
            <Text style={[styles.closeText, { color: tokens.color.text }]}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '78%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 4,
  },
  heading: {
    fontSize: 20,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  scroll: {
    gap: 16,
    paddingBottom: 8,
  },
  overview: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  block: {
    gap: 6,
  },
  blockTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  bullet: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  sourceLink: {
    fontSize: 14,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    gap: 10,
  },
  status: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  closeBtn: {
    marginTop: 4,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  closeText: {
    fontSize: 15,
    fontWeight: '800',
  },
});
