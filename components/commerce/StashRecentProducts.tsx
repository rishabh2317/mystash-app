import React, { useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { StashFilterBar } from './StashFilterBar';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { typeStyle } from '@/src/theme/typography';
import { bagCategoryKey, type BagItemView, type StashCategoryCardModel } from '@/src/ui/bag';
import { activeStashFilter, filterRecentStash, stashFilterOptions, STASH_FILTER_COPY } from '@/src/ui/stashFilters';

type Props = {
  items: BagItemView[];
  categories: StashCategoryCardModel[];
  renderGrid: (items: BagItemView[]) => ReactNode;
};

/** Account-keyed by Stash; existing Product cards/grid and collage navigation remain unchanged. */
export function StashRecentProducts({ items, categories, renderGrid }: Props) {
  const tokens = useThemeTokens();
  const [selected, setSelected] = useState<string | null>(null);
  const options = useMemo(() => stashFilterOptions(categories), [categories]);
  const active = activeStashFilter(options, selected);
  const filtered = useMemo(() => filterRecentStash(items, active, item => bagCategoryKey(item.category)), [active, items]);
  return <View style={{ gap: tokens.space.xs }}>
    <Text style={typeStyle(tokens, 'sectionTitle')}>{STASH_FILTER_COPY.recentlyStashed}</Text>
    <StashFilterBar options={options} selected={active} onSelect={setSelected} accessibilityLabel={STASH_FILTER_COPY.products} />
    {renderGrid(filtered)}
  </View>;
}
