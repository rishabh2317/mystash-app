import { useRouter, type Href } from 'expo-router';
import React, { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { DiscoverCreatorSuggestionCard } from '@/components/creator/DiscoverCreatorSuggestionCard';
import { ContentRail } from '@/components/ui/ContentRail';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useThemeMode } from '@/contexts/ThemeContext';
import { DISCOVER_CREATORS_COPY, type DiscoverCreatorSuggestion } from '@/src/ui/discoverCreators';
import { creatorProfileHref } from '@/src/ui/feedCreatorIdentity';

type Props = {
  items: DiscoverCreatorSuggestion[];
  loading: boolean;
};

const CARD_WIDTH = 132;
const CARD_GAP = 10;

/**
 * Presentational Discover Creators rail. Load state lives on the profile screen
 * so Collection/Saved (or Collections/Products) remounts do not refetch.
 */
export function DiscoverCreatorsSection({ items, loading }: Props) {
  const { tokens } = useThemeMode();
  const router = useRouter();

  const onPressCreator = useCallback(
    (username: string) => {
      router.push(creatorProfileHref(username) as Href);
    },
    [router],
  );

  const onSeeMore = useCallback(() => {
    router.push('/profile/discover-creators' as Href);
  }, [router]);

  if (!loading && items.length === 0) return null;

  return (
    <View style={[styles.wrap, { gap: tokens.space.sm }]}>
      <View style={{ paddingHorizontal: tokens.space.md }}>
        <SectionHeader
          title={DISCOVER_CREATORS_COPY.title}
          titleRole="tileTitle"
          actionLabel={DISCOVER_CREATORS_COPY.seeMore}
          onActionPress={onSeeMore}
        />
      </View>
      {loading ? (
        <ActivityIndicator
          style={{ marginVertical: tokens.space.sm }}
          color={tokens.color.textMuted}
        />
      ) : (
        <ContentRail
          gutter={tokens.space.md}
          itemPitch={CARD_WIDTH + CARD_GAP}
          itemGap={CARD_GAP}
        >
          {items.map((suggestion) => (
            <DiscoverCreatorSuggestionCard
              key={suggestion.creator.userId}
              suggestion={suggestion}
              variant="compact"
              onPressCreator={onPressCreator}
            />
          ))}
        </ContentRail>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 2,
  },
});
