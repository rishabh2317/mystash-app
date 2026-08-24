import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useThemeTokens } from '@/src/theme/useThemeTokens';

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
  const palette = noticePalette(tone, tokens.mode === 'titanium', tokens);

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
          gap: tokens.space.xxs + 2,
        },
      ]}
    >
      {title ? (
        <Text
          style={{
            color: palette.title,
            fontSize: tokens.fontSize.bodyStrong,
            fontWeight: tokens.fontWeight.extraBold,
          }}
        >
          {title}
        </Text>
      ) : null}
      <Text
        style={{
          color: palette.body,
          fontSize: 13,
          lineHeight: 18,
        }}
      >
        {body}
      </Text>
      {actionLabel && onAction ? (
        <TouchableOpacity onPress={onAction} style={styles.action} accessibilityRole="button">
          <Text
            style={{
              color: palette.action,
              fontSize: 13,
              fontWeight: tokens.fontWeight.extraBold,
            }}
          >
            {actionLabel}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function noticePalette(
  tone: CreateInlineNoticeTone,
  isLight: boolean,
  tokens: ReturnType<typeof useThemeTokens>,
) {
  if (tone === 'error') {
    return {
      border: isLight ? 'rgba(185,28,28,0.35)' : 'rgba(252,165,165,0.4)',
      bg: isLight ? 'rgba(254,226,226,0.95)' : 'rgba(127,29,29,0.35)',
      title: isLight ? '#991B1B' : tokens.color.danger,
      body: isLight ? '#7F1D1D' : tokens.color.danger,
      action: tokens.color.danger,
    };
  }
  if (tone === 'warning') {
    return {
      border: isLight ? 'rgba(180,83,9,0.4)' : 'rgba(251,191,36,0.45)',
      bg: isLight ? 'rgba(254,243,199,0.95)' : 'rgba(120,53,15,0.35)',
      title: isLight ? '#92400E' : tokens.color.warning,
      body: isLight ? '#78350F' : '#FEF3C7',
      action: tokens.color.warning,
    };
  }
  if (tone === 'success') {
    return {
      border: isLight ? 'rgba(5,150,105,0.35)' : 'rgba(16,185,129,0.4)',
      bg: isLight ? 'rgba(209,250,229,0.95)' : 'rgba(6,78,59,0.35)',
      title: isLight ? '#065F46' : tokens.color.success,
      body: isLight ? '#047857' : '#D1FAE5',
      action: tokens.color.success,
    };
  }
  return {
    border: isLight ? 'rgba(14,165,233,0.4)' : 'rgba(168,85,247,0.4)',
    bg: isLight ? 'rgba(224,242,254,0.95)' : 'rgba(88,28,135,0.28)',
    title: isLight ? '#0369A1' : tokens.color.accent,
    body: isLight ? '#0C4A6E' : '#E9D5FF',
    action: tokens.color.accent,
  };
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
  },
  action: { marginTop: 4, alignSelf: 'flex-start' },
});
