import React from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
/** In normal layout flow above the tab bar: no invisible overlay or keyboard trap. */
export function FindCaptureActions({ onPaste,onGallery,onCamera,imagesAvailable=false,busy=false }: { onPaste: () => void;onGallery?:()=>void;onCamera?:()=>void;imagesAvailable?:boolean;busy?:boolean }) {
  const { tokens } = useThemeMode();
  const { fontScale } = useWindowDimensions();
  const actions = [{ title: 'Paste URL', icon: 'link-outline', enabled: true,onPress:onPaste }, { title: 'Screenshot / Gallery', icon: 'scan-outline', enabled: imagesAvailable,onPress:onGallery }, { title: 'Camera', icon: 'camera-outline', enabled: imagesAvailable,onPress:onCamera }] as const;
  const controls = actions.map((action, index) =>
      <Pressable key={action.title} accessibilityRole="button" accessibilityLabel={action.enabled ? action.title==='Paste URL'?'Paste a URL to Find':action.title==='Camera'?'Take a photo to Find':'Choose a screenshot or photo to Find' : `${action.title}. Not available yet`}
        accessibilityState={{ disabled: !action.enabled||busy }} disabled={!action.enabled||busy} onPress={action.enabled ? action.onPress : undefined}
        style={({ pressed }) => ({ flex: fontScale > 1.4 ? undefined : 1, minWidth: fontScale > 1.4 ? tokens.space.xxl * 3 : 0, flexDirection: 'column', minHeight: 48, paddingVertical: tokens.space.xs, paddingHorizontal: tokens.space.xxs, alignItems: 'center', justifyContent: 'center', gap: tokens.space.xxs,
          opacity: pressed ? tokens.motion.pressOpacity : 1 })}>
        {index > 0 ? <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: tokens.space.sm, bottom: tokens.space.sm, width: tokens.stroke.thin, backgroundColor: tokens.color.border }} /> : null}
        <View style={{ width: '100%', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: tokens.space.xxs }}>
          <Ionicons name={action.icon} size={22} color={action.enabled ? tokens.color.text : tokens.color.textMuted} />
          <Text style={[typeStyle(tokens, 'tileMeta'), { flexShrink:1,minWidth:0,fontFamily: tokens.fontFamily.medium,color: action.enabled ? tokens.color.text : tokens.color.textMuted, textAlign: 'center' }]}>{action.title}</Text>
        </View>
        {!action.enabled ? <Text style={[typeStyle(tokens, 'tileMeta'), { textAlign: 'center' }]}>Not available yet</Text> : null}
      </Pressable>);
  return <View style={{ paddingHorizontal: tokens.space.sm, paddingTop: tokens.space.xs, backgroundColor: tokens.color.canvasSoft }}>
    {fontScale > 1.4 ? <ScrollView horizontal directionalLockEnabled showsHorizontalScrollIndicator={false} accessibilityLabel="Capture actions"
      style={{ borderWidth: tokens.stroke.thin, borderColor: tokens.color.border, borderRadius: tokens.radius.lg, backgroundColor: tokens.color.surface }}
      contentContainerStyle={{ alignItems: 'stretch' }}>{controls}</ScrollView>
      : <View style={{ flexDirection: 'row', borderWidth: tokens.stroke.thin, borderColor: tokens.color.border, borderRadius: tokens.radius.lg, backgroundColor: tokens.color.surface, overflow: 'hidden' }}>{controls}</View>}
  </View>;
}
