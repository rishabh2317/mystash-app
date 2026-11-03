import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FindImage } from './FindImage';
import {PrivateFindImage} from './PrivateFindImage';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { outlineCardChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import type { FindItem } from '@/src/services/findClient';
import { findResultLabel, findSourceLabel, findStatus } from '@/src/ui/find';
import { shareActivityRelativeTime } from '@/src/ui/shareActivity';
export function FindCard({ item, featured = false, onPress }: { item: FindItem; featured?: boolean; onPress: () => void }) {
  const { tokens } = useThemeMode(), status = findStatus(item);
  const icon = item.sourceType === 'image'?'image-outline':item.sourceType === 'youtube' ? 'logo-youtube' : item.sourceType === 'instagram' ? 'film-outline' : 'link-outline';
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${item.title || findSourceLabel(item.sourceType)}. ${status.label}. ${findResultLabel(item)}`}
    style={({ pressed }) => [{ ...outlineCardChrome(tokens), borderWidth: tokens.stroke.thin, borderRadius: tokens.radius.xxl, overflow: 'hidden', opacity: pressed ? tokens.motion.pressOpacity : 1 }, featured ? { flexGrow: 1 } : styles.row]}>
    <View style={[{ backgroundColor: tokens.color.surfaceSubtle, alignItems: 'center', justifyContent: 'center' }, featured ? styles.hero : styles.thumb]}>
      {item.sourceType==='image'?<PrivateFindImage id={item.id} style={StyleSheet.absoluteFill}/>:<FindImage url={item.thumbnailUrl} cacheKey={item.id} placeholder={icon} style={StyleSheet.absoluteFill} />}
      {featured ? <View style={[styles.source, { backgroundColor: tokens.color.canvasSoft, borderRadius: tokens.radius.sm }]}><Ionicons name={icon} size={18} color={tokens.color.text} /></View> : null}
    </View>
    <View style={{ flex: 1, minWidth: 0, padding: tokens.space.sm, gap: tokens.space.xs }}>
      <Text style={[typeStyle(tokens, 'body'), { fontFamily: tokens.fontFamily.semibold }]} numberOfLines={2}>{item.title || `From ${item.sourceType==='image'?'your image':item.sourceType === 'instagram' ? 'a Reel' : item.sourceType === 'youtube' ? 'a Short' : 'a link'}`}</Text>
      <Text style={typeStyle(tokens, 'caption')}>{findResultLabel(item)}</Text>
      <Text style={[typeStyle(tokens, 'caption'), { color: item.outcome.category === 'attention' ? tokens.color.danger : tokens.color.textMuted }]}>{status.label} · {shareActivityRelativeTime(item.createdAt)}</Text>
    </View>
    {!featured ? <Ionicons name="chevron-forward-outline" size={18} color={tokens.color.textMuted} style={{ marginRight: tokens.space.sm }} /> : null}
  </Pressable>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', minHeight: 94 }, thumb: { width: 76, minHeight: 94, alignSelf: 'stretch' }, hero: { width: '100%', aspectRatio: 1.35 }, source: { position: 'absolute', left: 10, top: 10, padding: 6 } });
