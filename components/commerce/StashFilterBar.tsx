import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { Text } from '@/components/ui/Text';
import { TactileFilterChip } from '@/components/ui/TactileFilterChip';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { typeStyle } from '@/src/theme/typography';
import { FEED_MIN_HIT_TARGET } from '@/src/ui/feedA11y';
import type { StashFilterOption } from '@/src/ui/stashFilters';
import { usePrefersReducedMotion } from '@/src/ui/usePrefersReducedMotion';

type Props = {
  options: readonly StashFilterOption[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  accessibilityLabel: string;
};

/** Single-row capsule controls; horizontal scrolling preserves large-text labels. */
export function StashFilterBar({ options, selected, onSelect, accessibilityLabel }: Props) {
  const tokens = useThemeTokens();
  const reduceMotion = usePrefersReducedMotion();
  const scroll = useRef<ScrollView>(null);
  const positions = useRef(new Map<string | null, number>());
  const revealSelection = useCallback(() => {
    const x = positions.current.get(selected);
    if (x !== undefined) scroll.current?.scrollTo({ x: Math.max(0, x - tokens.space.xs), animated: !reduceMotion });
  }, [reduceMotion, selected, tokens.space.xs]);
  useEffect(revealSelection, [revealSelection, options]);

  return <ScrollView ref={scroll} horizontal directionalLockEnabled nestedScrollEnabled
    accessibilityLabel={accessibilityLabel} showsHorizontalScrollIndicator={false}
    style={styles.scroll} onContentSizeChange={revealSelection}
    contentContainerStyle={{ flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: tokens.space.xs, paddingVertical: tokens.space.xs,
      paddingHorizontal: tokens.space.xxs }}>
    {options.map(option => {
      const active = selected === option.key;
      return <TactileFilterChip key={option.key === null ? 'all' : `category:${option.key}`} selected={active} accessibilityRole="button"
        accessibilityLabel={option.label} accessibilityState={{ selected: active }}
        onLayout={event => { positions.current.set(option.key, event.nativeEvent.layout.x); }}
        onPress={() => onSelect(option.key)}
        containerStyle={styles.chip} contentStyle={{ flexDirection: 'row', alignItems: 'center',
          minHeight: FEED_MIN_HIT_TARGET, gap: tokens.space.xs,
          paddingHorizontal: tokens.space.sm, paddingVertical: tokens.space.xs,
        }}>
        <Ionicons accessible={false} name={option.icon} size={tokens.fontSize.body} color={active ? tokens.color.text : tokens.color.textMuted} />
        <Text numberOfLines={1} style={[typeStyle(tokens, 'caption'), { color: tokens.color.text,
          fontFamily: active ? tokens.fontFamily.medium : tokens.fontFamily.regular }]}>{option.label}</Text>
      </TactileFilterChip>;
    })}
  </ScrollView>;
}
const styles = StyleSheet.create({
  scroll: { flexGrow: 0 }, chip: { flexShrink: 0 },
});
