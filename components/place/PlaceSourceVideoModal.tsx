import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';

import YouTubeReelItem from '@/components/YouTubeReelItem';
import InstagramReelItem from '@/components/InstagramReelItem';
import { ActionButton } from '@/components/ui/ActionButton';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import type { PlaceSourceVideo } from '@/src/types/placeStash';
import { FEED_MIN_HIT_TARGET } from '@/src/ui/feedA11y';
import { PLACE_SOURCE_COPY, placeSourcePreview } from '@/src/ui/placeSourceVideo';

/** A dismissible host for the existing feed embeds, not another player stack. */
export function PlaceSourceVideoModal({ source, sources, onClose }: { source: PlaceSourceVideo; sources?: PlaceSourceVideo[]; onClose: () => void }) {
  const [selectedUrl, setSelectedUrl] = useState(source.url);
  const activeSource = sources?.find(video => video.url === selectedUrl) ?? source;
  const { tokens } = useThemeMode();
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const video = useMemo(() => placeSourcePreview(activeSource), [activeSource]);
  const active = focused && foreground;
  const activeUrl = useRef(activeSource.url);
  activeUrl.current = activeSource.url;
  useEffect(() => { setFailed(false); setReady(false); setAttempt(0); }, [activeSource.url]);
  useEffect(() => { if (!focused) onClose(); }, [focused, onClose]);
  useEffect(() => {
    if (!active) setReady(false);
  }, [active]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!active || !video || ready || failed) return;
    const timer = setTimeout(() => setFailed(true), 20_000);
    return () => clearTimeout(timer);
  }, [active, video, ready, failed, attempt]);

  return (
    <Modal visible presentationStyle="fullScreen" animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.screen, { backgroundColor: tokens.color.canvas }]}>
        <View style={[styles.header, { padding: tokens.space.md, gap: tokens.space.sm }]}>
          <Text accessibilityRole="header" style={[typeStyle(tokens, 'chromeTitle'), { flex: 1 }]}>{PLACE_SOURCE_COPY.action}</Text>
          <ActionButton label={PLACE_SOURCE_COPY.close} leadingIcon="close-outline" variant="secondary" onPress={onClose} />
        </View>
        {sources && sources.length > 1 ? <ScrollView horizontal style={{ flexGrow: 0 }}
          contentContainerStyle={{ paddingHorizontal: tokens.space.md, gap: tokens.space.sm, paddingBottom: tokens.space.sm }}>
          {sources.map((item, index) => <Pressable key={item.url} accessibilityRole="button"
            accessibilityLabel={`Source video ${index + 1}`} accessibilityState={{ selected: item.url === activeSource.url }}
            onPress={() => setSelectedUrl(item.url)} style={{ minHeight: FEED_MIN_HIT_TARGET, justifyContent: 'center',
              paddingHorizontal: tokens.space.sm, borderRadius: tokens.radius.pill,
              backgroundColor: item.url === activeSource.url ? tokens.color.primarySurface : tokens.color.surfaceSubtle }}>
            <Text style={[typeStyle(tokens, 'caption'), { color: item.url === activeSource.url ? tokens.color.onPrimarySurface : tokens.color.textMuted }]}>Video {index + 1}</Text>
          </Pressable>)}
        </ScrollView> : null}
        {!video || failed ? (
          <View accessibilityLiveRegion="polite" style={[styles.center, { padding: tokens.space.lg, gap: tokens.space.md }]}>
            <Text style={typeStyle(tokens, 'sectionTitle')}>{PLACE_SOURCE_COPY.unavailable}</Text>
            <Text style={[typeStyle(tokens, 'bodyMuted'), { textAlign: 'center' }]}>{PLACE_SOURCE_COPY.unavailableHint}</Text>
            {video ? <ActionButton label={PLACE_SOURCE_COPY.retry} variant="secondary" onPress={() => {
              setFailed(false); setReady(false); setAttempt((n) => n + 1);
            }} /> : null}
          </View>
        ) : (
          <View style={[styles.player, { backgroundColor: tokens.immersive.stage, borderRadius: tokens.radius.lg,
            marginHorizontal: tokens.space.md, marginBottom: tokens.space.md }]}>
            {video.id.startsWith('source:youtube:') ? (
              <YouTubeReelItem key={`${video.id}:${attempt}`} video={video} isActive={active} onReady={() => { if (activeUrl.current === activeSource.url) setReady(true); }} onLoadError={() => { if (activeUrl.current === activeSource.url) setFailed(true); }} />
            ) : (
              <InstagramReelItem key={`${video.id}:${attempt}`} video={video} isActive={active} onReady={() => { if (activeUrl.current === activeSource.url) setReady(true); }} onLoadError={() => { if (activeUrl.current === activeSource.url) setFailed(true); }} />
            )}
          </View>
        )}
        {video && !failed && !ready ? (
          <Text accessibilityLiveRegion="polite" style={[typeStyle(tokens, 'bodyMuted'), { textAlign: 'center', padding: tokens.space.sm }]}>{PLACE_SOURCE_COPY.loading}</Text>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center' },
  player: { flex: 1, overflow: 'hidden', width: '90%', maxWidth: 560, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
