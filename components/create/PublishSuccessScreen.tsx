import { Image } from 'expo-image';
import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { Text as AppText } from '@/components/ui/Text';
import { outlineCardChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { CREATE_COPY } from '@/src/ui/createCopy';

type Props = {
  visible: boolean;
  /** @deprecated Colors come from ThemeMode tokens. */
  isLight?: boolean;
  title: string;
  productCountLabel: string;
  canViewCollection: boolean;
  onViewFeed: () => void;
  onViewCollection: () => void;
  onCreateAnother: () => void;
  /** Published Collection cover, shared by both publication entry points. */
  coverUrl?: string | null;
};

/** Full-screen publish success moment. Not an Alert. */
export function PublishSuccessScreen({
  visible,
  title,
  productCountLabel,
  canViewCollection,
  onViewFeed,
  onViewCollection,
  onCreateAnother,
  coverUrl,
}: Props) {
  const tokens = useThemeTokens();
  const chrome = outlineCardChrome(tokens);

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onViewFeed}>
      <View
        style={[
          styles.screen,
          {
            backgroundColor: tokens.color.canvas,
            paddingHorizontal: tokens.space.lg,
            gap: tokens.space.md,
          },
        ]}
      >
        <AppText style={typeStyle(tokens, 'tileMeta')}>Published</AppText>
        {coverUrl ? (
          <View
            style={[
              chrome,
              {
                borderWidth: StyleSheet.hairlineWidth,
                borderRadius: tokens.radius.lg,
                overflow: 'hidden',
              },
            ]}
          >
            <Image source={{ uri: coverUrl }} style={styles.editorCover} contentFit="cover" />
          </View>
        ) : (
          <View
            style={[
              chrome,
              styles.editorCover,
              {
                borderWidth: StyleSheet.hairlineWidth,
                borderRadius: tokens.radius.lg,
                backgroundColor: tokens.color.canvasEnd,
              },
            ]}
          />
        )}
        <AppText style={typeStyle(tokens, 'sectionTitle')} numberOfLines={2}>
          {title}
        </AppText>
        <AppText style={typeStyle(tokens, 'bodyMuted')}>{CREATE_COPY.publishSuccessTitle}</AppText>
        <AppText style={typeStyle(tokens, 'tileMeta')}>{productCountLabel}</AppText>
        <AppText style={typeStyle(tokens, 'bodyMuted')}>{CREATE_COPY.publishSuccessBody}</AppText>

        <View style={{ gap: tokens.space.sm, marginTop: tokens.space.sm }}>
          {canViewCollection ? (
            <ActionButton
              label={CREATE_COPY.publishSuccessViewCollection}
              variant="filled"
              onPress={onViewCollection}
            />
          ) : null}
          <ActionButton
            label={CREATE_COPY.publishSuccessViewFeed}
            variant="quiet"
            onPress={onViewFeed}
          />
          <ActionButton
            label={CREATE_COPY.publishSuccessCreateAnother}
            variant="quiet"
            onPress={onCreateAnother}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
  },
  editorCover: {
    width: '100%',
    height: 220,
  },
});
