import { FailureState } from '@/components/status/FailureState';
import React, { useCallback, useRef, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { findApi } from '@/src/services/findApi';
import { createStashSourcesController } from '@/src/state/stashSourcesController';
import { typeStyle } from '@/src/theme/typography';
import { StashSourceCard } from './StashSourceCard';

/** One mixed rail lives above the tabs; selecting a tab never remounts this reader. */
export function StashSourceRail({ owner, revision, onOpen }: { owner: string; revision: string; onOpen(id: string): void }) {
  const { tokens } = useThemeMode(), { width } = useWindowDimensions();
  const ref = useRef<ReturnType<typeof createStashSourcesController> | null>(null);
  if (!ref.current) ref.current = createStashSourcesController((kind, cursor, account) =>
    findApi.sourceSummaries(kind, { cursor: cursor ?? undefined }, account));
  const controller = ref.current;
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  useFocusEffect(useCallback(() => {
    void revision; controller.configure(owner); controller.setActive(true); void controller.refresh();
    return () => controller.setActive(false);
  }, [controller, owner, revision]));
  const visible = state.owner === owner ? state.items : [];
  const cardWidth = Math.max(112, Math.min(170, (width - 32 - 24) / 2.5));
  return <View style={{ gap: tokens.space.xs }}>
    <Text accessibilityRole="header" style={typeStyle(tokens, 'sectionTitle')}>Saved from your Finds</Text>
    {!state.loaded && !visible.length ? <ActivityIndicator color={tokens.color.primary} /> : visible.length ?
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: tokens.space.sm, paddingVertical: tokens.space.xxs, paddingRight: tokens.space.sm }}>
        {visible.map(source => <StashSourceCard key={source.id} source={source} width={cardWidth} onPress={() => onOpen(source.id)} />)}
        {state.hasMore ? <Pressable accessibilityRole="button" disabled={state.more} onPress={() => void controller.loadMore()}
          style={{ minWidth: 80, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={typeStyle(tokens, 'link')}>{state.more ? 'Loading…' : 'See more'}</Text>
        </Pressable> : null}
      </ScrollView> : !state.error ? <Text style={typeStyle(tokens, 'caption')}>Captures with saved items will appear here.</Text> : null}
    {state.error ? <FailureState error={state.error} variant="inline" onRetry={()=>void controller.refresh()} /> : null}
  </View>;
}
