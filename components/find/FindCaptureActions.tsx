import React from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
/** In normal layout flow above the tab bar: no invisible overlay or keyboard trap. */
export function FindCaptureActions({ onPaste,onGallery,onCamera,imagesAvailable=false,busy=false }: { onPaste: () => void;onGallery?:()=>void;onCamera?:()=>void;imagesAvailable?:boolean;busy?:boolean }) {
  const { tokens } = useThemeMode();
  const { fontScale } = useWindowDimensions();
  const actions = ([{ title: 'Paste URL', icon: 'link-outline', enabled: true,onPress:onPaste }, { title: 'Screenshot / Gallery', icon: 'scan-outline', enabled: imagesAvailable,onPress:onGallery }, { title: 'Camera', icon: 'camera-outline', enabled: imagesAvailable,onPress:onCamera }] as const)
    .filter(action => action.enabled || fontScale <= 1.4);
  return <View style={{ flexDirection: 'row', padding: tokens.space.sm, gap: tokens.space.xs, borderTopWidth: tokens.stroke.thin, borderColor: tokens.color.border, backgroundColor: tokens.color.canvasSoft }}>
    {actions.map(action =>
      <Pressable key={action.title} accessibilityRole="button" accessibilityLabel={action.enabled ? action.title==='Paste URL'?'Paste a URL to Find':action.title==='Camera'?'Take a photo to Find':'Choose a screenshot or photo to Find' : `${action.title}. Not available yet`}
        accessibilityState={{ disabled: !action.enabled||busy }} disabled={!action.enabled||busy} onPress={action.enabled ? action.onPress : undefined}
        style={{ flex: 1, flexDirection: fontScale > 1.4 ? 'row' : 'column', minHeight: 68, paddingVertical: tokens.space.xs, paddingHorizontal: tokens.space.xxs, alignItems: 'center', justifyContent: 'center', gap: tokens.space.xs,
          borderRadius: tokens.radius.xxl, backgroundColor: action.enabled ? tokens.color.primarySurface : 'transparent' }}>
        <Ionicons name={action.icon} size={24} color={action.enabled ? tokens.color.onPrimarySurface : tokens.color.textMuted} />
        <Text style={[typeStyle(tokens, 'caption'), { flexShrink:1,maxWidth:'100%',color: action.enabled ? tokens.color.onPrimarySurface : tokens.color.textMuted, textAlign: 'center' }]}>{action.title}</Text>
        {!action.enabled ? <Text style={[typeStyle(tokens, 'tileMeta'), { textAlign: 'center' }]}>Not available yet</Text> : null}
      </Pressable>)}
  </View>;
}
