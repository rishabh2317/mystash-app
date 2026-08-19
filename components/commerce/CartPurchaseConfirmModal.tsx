import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useThemeMode } from '@/contexts/ThemeContext';
import { BAG_COPY } from '@/src/ui/contracts';

type Props = {
  visible: boolean;
  /** @deprecated Colors come from ThemeMode tokens. */
  isLight?: boolean;
  productTitle?: string | null;
  onYes: () => void;
  onNo: () => void;
};

/** Internal name stays Cart*; user-facing copy is Keep in Bag? */
export function CartPurchaseConfirmModal({
  visible,
  productTitle,
  onYes,
  onNo,
}: Props) {
  const { tokens } = useThemeMode();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onNo}>
      <View style={[styles.backdrop, { backgroundColor: tokens.overlay.scrim }]}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: tokens.color.canvasEnd,
              borderRadius: tokens.radius.xl,
            },
          ]}
        >
          <Text style={[styles.title, { color: tokens.color.text }]}>{BAG_COPY.keepInBag}</Text>
          {productTitle ? (
            <Text style={[styles.subtitle, { color: tokens.color.textMuted }]} numberOfLines={2}>
              {productTitle}
            </Text>
          ) : (
            <Text style={[styles.subtitle, { color: tokens.color.textMuted }]}>
              Did you buy this product?
            </Text>
          )}
          <View style={styles.row}>
            <Pressable
              onPress={onNo}
              style={[styles.btn, { borderColor: tokens.color.border, borderRadius: tokens.radius.md }]}
              accessibilityRole="button"
              accessibilityLabel={BAG_COPY.keepInBagAction}
            >
              <Text style={{ color: tokens.color.text, fontWeight: '700' }}>
                {BAG_COPY.keepInBagAction}
              </Text>
            </Pressable>
            <Pressable
              onPress={onYes}
              style={[
                styles.btn,
                styles.yesBtn,
                { backgroundColor: tokens.color.cta, borderRadius: tokens.radius.md },
              ]}
              accessibilityRole="button"
              accessibilityLabel={BAG_COPY.removeFromBag}
            >
              <Text style={{ color: tokens.color.successOn, fontWeight: '800' }}>Remove</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    padding: 20,
    gap: 12,
  },
  title: { fontSize: 18, fontWeight: '800' },
  subtitle: { fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', gap: 10, marginTop: 8 },
  btn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
  },
  yesBtn: { borderWidth: 0 },
});
