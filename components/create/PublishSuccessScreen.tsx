import { Image } from 'expo-image';
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

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
  /** Collection cover when the editor completion layout is used. */
  coverUrl?: string | null;
  /**
   * `editor` is the Edit Collection completion moment.
   * Default `studio` preserves Creator Studio appearance and actions.
   */
  layout?: 'studio' | 'editor';
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
  layout = 'studio',
}: Props) {
  const tokens = useThemeTokens();
  const chrome = outlineCardChrome(tokens);

  if (layout === 'editor') {
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

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onViewFeed}>
      <View
        style={[
          styles.screen,
          {
            backgroundColor: tokens.color.canvasSoftEnd,
            paddingHorizontal: tokens.space.lg + 4,
            gap: tokens.space.sm - 2,
          },
        ]}
      >
        <Text
          style={{
            color: tokens.color.success,
            fontSize: 13,
            fontWeight: tokens.fontWeight.extraBold,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          }}
        >
          Published
        </Text>
        <Text
          style={{
            color: tokens.color.text,
            fontSize: 28,
            fontWeight: tokens.fontWeight.extraBold,
            marginTop: 4,
          }}
        >
          {CREATE_COPY.publishSuccessTitle}
        </Text>
        <Text
          style={{
            color: tokens.color.textMuted,
            fontSize: tokens.fontSize.body,
            lineHeight: 22,
            marginBottom: tokens.space.xs,
          }}
        >
          {CREATE_COPY.publishSuccessBody}
        </Text>
        <Text
          style={{
            color: tokens.color.text,
            fontSize: tokens.fontSize.title,
            fontWeight: tokens.fontWeight.bold,
          }}
          numberOfLines={2}
        >
          {title}
        </Text>
        <Text
          style={{
            color: tokens.color.textMuted,
            fontSize: tokens.fontSize.bodyStrong,
            fontWeight: tokens.fontWeight.semibold,
          }}
        >
          {productCountLabel}
        </Text>

        <View style={[styles.actions, { marginTop: tokens.space.lg + 4, gap: tokens.space.sm }]}>
          <Pressable
            onPress={onViewFeed}
            style={[
              styles.primaryBtn,
              {
                backgroundColor: tokens.color.cta,
                borderRadius: tokens.radius.md,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={CREATE_COPY.publishSuccessViewFeed}
          >
            <Text
              style={{
                color: tokens.color.successOn,
                fontWeight: tokens.fontWeight.extraBold,
                fontSize: tokens.fontSize.body,
              }}
            >
              {CREATE_COPY.publishSuccessViewFeed}
            </Text>
          </Pressable>
          {canViewCollection ? (
            <Pressable
              onPress={onViewCollection}
              style={[
                styles.secondaryBtn,
                {
                  borderColor: tokens.color.border,
                  borderRadius: tokens.radius.md,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={CREATE_COPY.publishSuccessViewCollection}
            >
              <Text
                style={{
                  color: tokens.color.accent,
                  fontWeight: tokens.fontWeight.extraBold,
                }}
              >
                {CREATE_COPY.publishSuccessViewCollection}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={onCreateAnother}
            style={styles.tertiaryBtn}
            accessibilityRole="button"
            accessibilityLabel={CREATE_COPY.publishSuccessCreateAnother}
          >
            <Text
              style={{
                color: tokens.color.textMuted,
                fontWeight: tokens.fontWeight.bold,
              }}
            >
              {CREATE_COPY.publishSuccessCreateAnother}
            </Text>
          </Pressable>
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
  actions: {},
  primaryBtn: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtn: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  tertiaryBtn: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
