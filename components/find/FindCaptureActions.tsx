import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { FIND_CAPTURE_ACTION_COLORS } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';

/** Three independent capture tiles in normal flow above the existing tab bar. */
export function FindCaptureActions({ onPaste,onGallery,onCamera,imagesAvailable=false,busy=false }: { onPaste: () => void;onGallery?:()=>void;onCamera?:()=>void;imagesAvailable?:boolean;busy?:boolean }) {
  const { tokens } = useThemeMode();
  const colors = FIND_CAPTURE_ACTION_COLORS[tokens.mode];
  const actions = [{ title: 'Paste URL', icon: 'link-outline', enabled: true,onPress:onPaste }, { title: 'Gallery', icon: 'image-outline', enabled: imagesAvailable,onPress:onGallery }, { title: 'Camera', icon: 'camera-outline', enabled: imagesAvailable,onPress:onCamera }] as const;
  return <View style={{ paddingHorizontal: tokens.space.sm, paddingTop: tokens.space.xs, backgroundColor: tokens.color.canvasSoft }}>
    <View accessibilityLabel="Capture actions" style={{ flexDirection: 'row', alignItems: 'stretch', gap: tokens.space.xs }}>
      {actions.map(action => <Pressable key={action.title} accessibilityRole="button"
        accessibilityLabel={action.enabled ? action.title==='Paste URL'?'Paste a URL to Find':action.title==='Camera'?'Take a photo to Find':'Choose a screenshot or photo to Find' : `${action.title}. Not available yet`}
        accessibilityState={{ disabled: !action.enabled||busy }} disabled={!action.enabled||busy} onPress={action.enabled ? action.onPress : undefined}
        style={({ pressed }) => ({ flex: 1, minWidth: 0, flexDirection: 'column', minHeight: 80, paddingVertical: tokens.space.sm,
          paddingHorizontal: tokens.space.xxs, alignItems: 'center', justifyContent: 'center', gap: tokens.space.xxs,
          borderWidth: tokens.stroke.thin, borderColor: pressed ? colors.pressedBorder : colors.border,
          borderRadius: tokens.radius.lg, backgroundColor: pressed ? colors.pressed : colors.surface,
          opacity: controlOpacity(resolveControlPhase({ disabled: !action.enabled || busy, pressed }), tokens.motion.pressOpacity) })}>
        <Ionicons accessible={false} name={action.icon} size={24} color={action.enabled ? colors.icon : tokens.color.textMuted} />
        <Text style={[typeStyle(tokens, 'caption'), { alignSelf: 'stretch', textAlign: 'center', fontFamily: tokens.fontFamily.medium,
          color: action.enabled ? tokens.color.text : tokens.color.textMuted }]}>{action.title}</Text>
        {!action.enabled ? <Text style={[typeStyle(tokens, 'tileMeta'), { textAlign: 'center' }]}>Not available yet</Text> : null}
      </Pressable>)}
    </View>
  </View>;
}
