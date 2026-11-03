import React from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
/** In normal layout flow above the tab bar: no invisible overlay or keyboard trap. */
export function FindCaptureActions({ onPaste }: { onPaste: () => void }) {
  const { tokens } = useThemeMode();
  const { fontScale } = useWindowDimensions();
  const actions = ([{ title: 'Paste URL', icon: 'link-outline', enabled: true }, { title: 'Screenshot', icon: 'scan-outline', enabled: false }, { title: 'Camera', icon: 'camera-outline', enabled: false }] as const)
    .filter(action => action.enabled || fontScale <= 1.4);
  return <View style={{ flexDirection: 'row', padding: tokens.space.sm, gap: tokens.space.xs, borderTopWidth: tokens.stroke.thin, borderColor: tokens.color.border, backgroundColor: tokens.color.canvasSoft }}>
    {actions.map(action =>
      <Pressable key={action.title} accessibilityRole="button" accessibilityLabel={action.enabled ? 'Paste a URL to Find' : `${action.title}. Not available yet`}
        accessibilityState={{ disabled: !action.enabled }} disabled={!action.enabled} onPress={action.enabled ? onPaste : undefined}
        style={{ flex: 1, flexDirection: fontScale > 1.4 ? 'row' : 'column', minHeight: 68, paddingVertical: tokens.space.xs, paddingHorizontal: tokens.space.xxs, alignItems: 'center', justifyContent: 'center', gap: tokens.space.xs,
          borderRadius: tokens.radius.xxl, backgroundColor: action.enabled ? tokens.color.primarySurface : 'transparent' }}>
        <Ionicons name={action.icon} size={24} color={action.enabled ? tokens.color.onPrimarySurface : tokens.color.textMuted} />
        <Text style={[typeStyle(tokens, 'caption'), { color: action.enabled ? tokens.color.onPrimarySurface : tokens.color.textMuted, textAlign: 'center' }]}>{action.title}</Text>
        {!action.enabled ? <Text style={[typeStyle(tokens, 'tileMeta'), { textAlign: 'center' }]}>Not available yet</Text> : null}
      </Pressable>)}
  </View>;
}
