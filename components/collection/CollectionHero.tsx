import React from 'react';
import { View } from 'react-native';

import { ExpandableText } from '@/components/ui/ExpandableText';
import { MetaBar } from '@/components/ui/MetaBar';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import type { CollectionDetailViewModel } from '@/src/types/collectionDetail';
import { COLLECTION_SECTION_COPY, collectionMetaItems } from '@/src/ui/collectionSections';

type Props = {
  collection: CollectionDetailViewModel;
};

/** Lines of the collection title shown before the expand toggle appears. */
const TITLE_COLLAPSED_LINES = 2;

/**
 * Collection-first hero: title, caption, quiet metadata.
 * Curator credit lives below the media tile so the curated work leads.
 */
export function CollectionHero({ collection }: Props) {
  const { tokens } = useThemeMode();
  const title = collection.title?.trim() || 'Collection';
  const caption = collection.caption?.trim() ?? '';
  const metaItems = collectionMetaItems(collection);

  return (
    <View style={{ gap: tokens.space.sm, paddingTop: tokens.space.xs }}>
      <ExpandableText
        text={title}
        collapsedLines={TITLE_COLLAPSED_LINES}
        accessibilityRole="header"
        expandLabel={COLLECTION_SECTION_COPY.showMore}
        collapseLabel={COLLECTION_SECTION_COPY.showLess}
        style={typeStyle(tokens, 'identityTitle')}
      />

      {caption ? <Text style={typeStyle(tokens, 'bodyMuted')}>{caption}</Text> : null}

      <MetaBar items={metaItems.map((item) => ({ ...item }))} />
    </View>
  );
}
