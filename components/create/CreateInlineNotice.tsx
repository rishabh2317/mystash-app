import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { typeStyle } from '@/src/theme/typography';
import { hitSlopToMinTarget } from '@/src/ui/feedA11y';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { FailureState } from '@/components/status/FailureState';

export type CreateInlineNoticeTone = 'error' | 'info' | 'warning' | 'success';

type Props = {
  tone: CreateInlineNoticeTone;
  title?: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  /** @deprecated Colors come from ThemeMode tokens. */
  isLight?: boolean;
};

/** Shared Create-stack inline notice (UX-CREATE-B.6/B.8). Not an Alert. */
export function CreateInlineNotice({
  tone,
  title,
  body,
  actionLabel,
  onAction,
}: Props) {
  const tokens = useThemeTokens();
  if (tone === 'error') return <FailureState variant="inline" title={title} message={body} onRetry={onAction} actionLabel={actionLabel} />;
  const palette = noticePalette(tone, tokens);

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.wrap,
        {
          borderColor: palette.border,
          backgroundColor: palette.bg,
          borderRadius: tokens.radius.md,
          padding: tokens.space.sm,
          gap: tokens.space.xxs,
        },
      ]}
    >
      {title ? (
        <Text
          style={{
            color: palette.title,
            fontSize: tokens.fontSize.bodyStrong,
            lineHeight: tokens.lineHeight.bodyStrong,
            fontFamily: tokens.fontFamily.semibold,
          }}
        >
          {title}
        </Text>
      ) : null}
      <Text
        style={[typeStyle(tokens, 'caption'), { color: palette.body }]}
      >
        {body}
      </Text>
      {actionLabel && onAction ? (
        <TouchableOpacity onPress={onAction} activeOpacity={tokens.motion.pressOpacity}
          hitSlop={hitSlopToMinTarget(tokens.lineHeight.caption)} style={[styles.action, { marginTop: tokens.space.xxs }]} accessibilityRole="button">
          <Text
            style={{
              color: palette.action,
              fontSize: tokens.fontSize.caption,
              lineHeight: tokens.lineHeight.caption,
              fontFamily: tokens.fontFamily.semibold,
            }}
          >
            {actionLabel}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function noticePalette(tone: CreateInlineNoticeTone, tokens: ReturnType<typeof useThemeTokens>) {
  const foreground = tone === 'error' ? tokens.color.danger : tone === 'warning' ? tokens.color.warning
    : tone === 'success' ? tokens.color.success : tokens.color.text;
  return { border: tokens.color.border, bg: tokens.color.surfaceSubtle,
    title: foreground, body: tokens.color.text, action: tokens.color.primary };
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  action: { alignSelf: 'flex-start' },
});
