import { Image } from 'expo-image';
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  View,
} from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { Text } from '@/components/ui/Text';
import { outlineCardChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
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

/** Compact confirm sheet before publish. Not an Alert. */
export function PublishConfirmSheet({
  visible,
  summary,
  publishing,
  onConfirm,
  onCancel,
}: Props) {
  const tokens = useThemeTokens();
  const chrome = outlineCardChrome(tokens);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={publishing ? undefined : onCancel}>
      <View style={[styles.backdrop, { backgroundColor: tokens.overlay.scrim }]}>
        <View
          style={[
            styles.card,
            chrome,
            {
              borderWidth: StyleSheet.hairlineWidth,
              borderRadius: tokens.radius.lg,
              padding: tokens.space.md,
              gap: tokens.space.sm,
            },
          ]}
        >
          {summary.thumbnailUrl ? (
            <Image
              source={{ uri: summary.thumbnailUrl }}
              style={[styles.cover, { borderRadius: tokens.radius.md }]}
              contentFit="cover"
            />
          ) : (
            <View
              style={[
                styles.cover,
                { backgroundColor: tokens.color.canvasEnd, borderRadius: tokens.radius.md },
              ]}
            />
          )}
          <Text style={typeStyle(tokens, 'tileTitle')} numberOfLines={2}>
            {summary.title}
          </Text>
          <Text style={typeStyle(tokens, 'sectionTitle')}>{CREATE_COPY.publishConfirmReady}</Text>
          <Text style={typeStyle(tokens, 'bodyMuted')}>{summary.previewLine}</Text>
          <Text style={typeStyle(tokens, 'tileMeta')}>{publishProductCountLabel(summary.productCount)}</Text>

          {publishing ? (
            <View style={[styles.publishingRow, { minHeight: 48, gap: tokens.space.sm }]}>
              <ActivityIndicator color={tokens.color.primary} />
              <Text style={typeStyle(tokens, 'bodyMuted')}>{CREATE_COPY.publishPublishing}</Text>
            </View>
          ) : (
            <View style={{ gap: tokens.space.xs, marginTop: tokens.space.xs }}>
              <ActionButton
                label={CREATE_COPY.publishConfirmPrimary}
                variant="filled"
                onPress={onConfirm}
                accessibilityLabel={CREATE_COPY.publishConfirmPrimary}
              />
              <ActionButton
                label={CREATE_COPY.publishConfirmSecondary}
                variant="quiet"
                onPress={onCancel}
                accessibilityLabel={CREATE_COPY.publishConfirmSecondary}
              />
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
    paddingHorizontal: 24,
  },
  card: {},
  cover: { width: '100%', height: 120 },
  publishingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
