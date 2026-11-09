import React from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { TactileFilterChip } from '@/components/ui/TactileFilterChip';
import { useThemeMode } from '@/contexts/ThemeContext';
import type { SearchEntityType } from '@/src/services/searchApi';
import { typeStyle } from '@/src/theme/typography';

const TABS: { id: SearchEntityType; label: string }[] = [
  { id: 'collection', label: 'Collections' },
  { id: 'creator', label: 'Creators' },
  { id: 'product', label: 'Products' },
];

export function SearchResultsTabs({ selected, onSelect }: { selected: SearchEntityType; onSelect(value: SearchEntityType): void }) {
  const { tokens } = useThemeMode();
  return <View accessibilityRole="tablist" accessibilityLabel="Search results" style={{ flexDirection: 'row', gap: tokens.space.xs }}>
    {TABS.map(tab => {
      const active = tab.id === selected;
      return <TactileFilterChip key={tab.id} selected={active} accessibilityRole="tab" accessibilityLabel={tab.label}
        accessibilityState={{ selected: active }} onPress={() => onSelect(tab.id)}
        containerStyle={{ flex: 1, minWidth: 0 }} contentStyle={{ minHeight: 48, alignItems: 'center', justifyContent: 'center',
          paddingHorizontal: tokens.space.xxs, paddingVertical: tokens.space.xs }}>
        <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}
          style={[typeStyle(tokens, 'caption'), { color: tokens.color.text, textAlign: 'center',
            fontFamily: active ? tokens.fontFamily.medium : tokens.fontFamily.regular }]}>{tab.label}</Text>
      </TactileFilterChip>;
    })}
  </View>;
}
