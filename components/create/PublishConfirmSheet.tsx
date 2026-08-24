import { Image } from 'expo-image';
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { CREATE_COPY } from '@/src/ui/createCopy';
import {
  publishProductCountLabel,
  type PublishConfirmSummary,
} from '@/src/ui/createPublishRitual';

type Props = {
  visible: boolean;
  /** @deprecated Colors come from ThemeMode tokens. */
  isLight?: boolean;
  summary: PublishConfirmSummary;
  publishing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Light confirm sheet before publish (UX-CREATE-B.7 / B.8 tokens). Not an Alert. */
export function PublishConfirmSheet({
  visible,
  summary,
  publishing,
  onConfirm,
  onCancel,
}: Props) {
  const tokens = useThemeTokens();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={publishing ? undefined : onCancel}>
      <View style={[styles.backdrop, { backgroundColor: tokens.overlay.scrim }]}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: tokens.color.canvasSoft,
              borderColor: tokens.color.border,
              borderRadius: tokens.radius.xl,
              padding: tokens.space.md + 2,
              gap: tokens.space.sm,
            },
          ]}
        >
          <Text
            style={{
              color: tokens.color.text,
              fontSize: tokens.fontSize.title + 1,
              fontWeight: tokens.fontWeight.extraBold,
            }}
          >
            {CREATE_COPY.publishConfirmTitle}
          </Text>
          <Text
            style={{
              color: tokens.color.textMuted,
              fontSize: tokens.fontSize.bodyStrong,
              lineHeight: 20,
            }}
          >
            {summary.previewLine}
          </Text>

          <View style={styles.summaryRow}>
            {summary.thumbnailUrl ? (
              <Image
                source={{ uri: summary.thumbnailUrl }}
                style={[styles.thumb, { borderRadius: tokens.radius.md }]}
                contentFit="cover"
              />
            ) : (
              <View
                style={[
                  styles.thumb,
                  { backgroundColor: tokens.color.canvasEnd, borderRadius: tokens.radius.md },
                ]}
              />
            )}
            <View style={{ flex: 1, gap: 4 }}>
              <Text
                style={{
                  color: tokens.color.text,
                  fontSize: tokens.fontSize.body,
                  fontWeight: tokens.fontWeight.bold,
                }}
                numberOfLines={2}
              >
                {summary.title}
              </Text>
              <Text
                style={{
                  color: tokens.color.textMuted,
                  fontSize: 13,
                  fontWeight: tokens.fontWeight.semibold,
                }}
              >
                {publishProductCountLabel(summary.productCount)}
              </Text>
            </View>
          </View>

          {publishing ? (
            <View style={styles.publishingRow}>
              <ActivityIndicator color={tokens.color.cta} />
              <Text
                style={{
                  color: tokens.color.textMuted,
                  fontSize: tokens.fontSize.bodyStrong,
                  fontWeight: tokens.fontWeight.semibold,
                }}
              >
                {CREATE_COPY.publishPublishing}
              </Text>
            </View>
          ) : (
            <View style={[styles.actions, { gap: tokens.space.sm - 2, marginTop: tokens.space.xs }]}>
              <Pressable
                onPress={onCancel}
                style={[
                  styles.secondaryBtn,
                  {
                    borderColor: tokens.color.border,
                    borderRadius: tokens.radius.md,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={CREATE_COPY.publishConfirmSecondary}
              >
                <Text
                  style={{
                    color: tokens.color.text,
                    fontWeight: tokens.fontWeight.bold,
                  }}
                >
                  {CREATE_COPY.publishConfirmSecondary}
                </Text>
              </Pressable>
              <Pressable
                onPress={onConfirm}
                style={[
                  styles.primaryBtn,
                  {
                    backgroundColor: tokens.color.cta,
                    borderRadius: tokens.radius.md,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={CREATE_COPY.publishConfirmPrimary}
              >
                <Text
                  style={{
                    color: tokens.color.successOn,
                    fontWeight: tokens.fontWeight.extraBold,
                  }}
                >
                  {CREATE_COPY.publishConfirmPrimary}
                </Text>
              </Pressable>
            </View>
          )}
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
    borderWidth: 1,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  thumb: { width: 64, height: 64 },
  publishingRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
  },
  actions: { flexDirection: 'row' },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  primaryBtn: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
});
