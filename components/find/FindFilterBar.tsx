import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { TactileFilterChip } from '@/components/ui/TactileFilterChip';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import { FEED_MIN_HIT_TARGET } from '@/src/ui/feedA11y';
import type { FindViewFilter } from '@/src/ui/find';

export type FindFilter = { id: FindViewFilter; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; count: number | null };

/** Three equal-width capsules stay inside the page gutter at every font scale. */
export function FindFilterBar({ filters, selected, onSelect }: { filters: FindFilter[]; selected: FindViewFilter; onSelect(value: FindViewFilter): void }) {
  const { tokens } = useThemeMode();
  return <View accessibilityLabel="Filter Finds" style={{ flexDirection: 'row', alignItems: 'stretch', gap: tokens.space.xs, paddingVertical: tokens.space.xs }}>
    {filters.map(filter => {
      const active = selected === filter.id;
      return <TactileFilterChip key={filter.id} selected={active} onPress={() => onSelect(filter.id)}
        accessibilityRole="button" accessibilityLabel={`${filter.label}, ${filter.count === null ? 'loading' : `${filter.count} finds`}`} accessibilityState={{ selected: active }}
        containerStyle={{ flex: 1, minWidth: 0 }}
        contentStyle={{ minHeight: FEED_MIN_HIT_TARGET, alignItems: 'center', justifyContent: 'center',
          paddingHorizontal: tokens.space.xxs, paddingVertical: tokens.space.xxs }}>
        <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.85}
          style={[typeStyle(tokens, 'caption'), { color: tokens.color.text, fontFamily: active ? tokens.fontFamily.medium : tokens.fontFamily.regular, textAlign: 'center' }]}>{filter.label}</Text>
        <Text numberOfLines={1} style={[typeStyle(tokens, 'caption'), { color: tokens.color.textMuted,
          fontSize: tokens.fontSize.micro, lineHeight: tokens.lineHeight.micro,
          fontFamily: tokens.fontFamily.medium }]}>{filter.count ?? '—'}</Text>
      </TactileFilterChip>;
    })}
  </View>;
}
