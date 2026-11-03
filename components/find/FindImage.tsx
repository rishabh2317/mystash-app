import React, { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useThemeMode } from '@/contexts/ThemeContext';
import { safeFindUrl } from '@/src/ui/find';
export function FindImage({ url, cacheKey, style, placeholder = 'image-outline' }: { url: string | null; cacheKey: string; style: StyleProp<ViewStyle>; placeholder?: React.ComponentProps<typeof Ionicons>['name'] }) {
  const { tokens } = useThemeMode(), source = safeFindUrl(url), [failed,setFailed] = useState<string | null>(null);
  return <View style={[{ backgroundColor: tokens.color.surfaceSubtle, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, style]} accessible={false}>
    {source && failed !== source ? <Image source={{ uri: source }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" recyclingKey={`${cacheKey}:${source}`} transition={tokens.motion.thumbnailFadeMs} onError={() => setFailed(source)} accessible={false} />
      : <Ionicons name={placeholder} size={28} color={tokens.color.textMuted} />}
  </View>;
}
