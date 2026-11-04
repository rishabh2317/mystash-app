import React, { useCallback, useEffect, useRef } from 'react';
import { Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { stashFilterChipChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import { FEED_MIN_HIT_TARGET } from '@/src/ui/feedA11y';
import { usePrefersReducedMotion } from '@/src/ui/usePrefersReducedMotion';
import type { FindViewFilter } from '@/src/ui/find';

export type FindFilter = { id: FindViewFilter; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; count: number | null };

/** The same capsule treatment as Stash, with Find's existing filters and counts. */
export function FindFilterBar({ filters, selected, onSelect }: { filters: FindFilter[]; selected: FindViewFilter; onSelect(value: FindViewFilter): void }) {
  const { tokens } = useThemeMode(), reduceMotion = usePrefersReducedMotion();
  const scroll = useRef<ScrollView>(null), positions = useRef(new Map<FindViewFilter, number>());
  const reveal = useCallback(() => {
    const x = positions.current.get(selected);
    if (x !== undefined) scroll.current?.scrollTo({ x: Math.max(0, x - tokens.space.xs), animated: !reduceMotion });
  }, [reduceMotion, selected, tokens.space.xs]);
  useEffect(reveal, [reveal, filters.length]);
  return <ScrollView ref={scroll} horizontal directionalLockEnabled nestedScrollEnabled showsHorizontalScrollIndicator={false}
    accessibilityLabel="Filter Finds" onContentSizeChange={reveal} style={{ flexGrow: 0 }}
    contentContainerStyle={{ flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: tokens.space.xs, paddingVertical: tokens.space.xs, paddingHorizontal: tokens.space.xxs }}>
    {filters.map(filter => {
      const active = selected === filter.id;
      return <Pressable key={filter.id} onPress={() => onSelect(filter.id)} onLayout={event => { positions.current.set(filter.id, event.nativeEvent.layout.x); }}
        accessibilityRole="button" accessibilityLabel={`${filter.label}, ${filter.count === null ? 'loading' : `${filter.count} finds`}`} accessibilityState={{ selected: active }}
        style={({ pressed }) => [{ flexShrink: 0, flexDirection: 'row', alignItems: 'center', minHeight: FEED_MIN_HIT_TARGET,
          gap: tokens.space.xs, paddingHorizontal: tokens.space.sm, paddingVertical: tokens.space.xs,
          opacity: pressed ? tokens.motion.pressOpacity : 1 }, stashFilterChipChrome(tokens, active)]}>
        <Ionicons accessible={false} name={filter.icon} size={tokens.fontSize.body} color={active ? tokens.color.text : tokens.color.textMuted} />
        <Text style={[typeStyle(tokens, 'caption'), { color: tokens.color.text, fontFamily: active ? tokens.fontFamily.medium : tokens.fontFamily.regular }]}>{filter.label} {filter.count ?? '—'}</Text>
      </Pressable>;
    })}
  </ScrollView>;
}
