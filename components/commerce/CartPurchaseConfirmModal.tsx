import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  visible: boolean;
  isLight: boolean;
  productTitle?: string | null;
  onYes: () => void;
  onNo: () => void;
};

export function CartPurchaseConfirmModal({
  visible,
  isLight,
  productTitle,
  onYes,
  onNo,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onNo}>
      <View style={styles.backdrop}>
        <View
          style={[
            styles.card,
            { backgroundColor: isLight ? '#FFFFFF' : '#0F172A' },
          ]}
        >
          <Text style={[styles.title, { color: isLight ? '#0F172A' : '#F8FAFC' }]}>
            Did you buy this product?
          </Text>
          {productTitle ? (
            <Text style={[styles.subtitle, { color: isLight ? '#475569' : '#94A3B8' }]} numberOfLines={2}>
              {productTitle}
            </Text>
          ) : null}
          <View style={styles.row}>
            <Pressable
              onPress={onNo}
              style={[styles.btn, { borderColor: isLight ? '#CBD5E1' : '#475569' }]}
              accessibilityRole="button"
              accessibilityLabel="No, keep in cart"
            >
              <Text style={{ color: isLight ? '#0F172A' : '#F8FAFC', fontWeight: '700' }}>No</Text>
            </Pressable>
            <Pressable
              onPress={onYes}
              style={[styles.btn, styles.yesBtn, { backgroundColor: isLight ? '#0EA5E9' : '#A855F7' }]}
              accessibilityRole="button"
              accessibilityLabel="Yes, remove from cart"
            >
              <Text style={{ color: '#fff', fontWeight: '800' }}>Yes</Text>
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
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    borderRadius: 16,
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
    borderRadius: 12,
    borderWidth: 1,
  },
  yesBtn: { borderWidth: 0 },
});
