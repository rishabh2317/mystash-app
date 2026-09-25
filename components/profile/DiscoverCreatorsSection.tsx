import { useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { DiscoverCreatorSuggestionCard } from '@/components/creator/DiscoverCreatorSuggestionCard';
import { ContentRail } from '@/components/ui/ContentRail';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useThemeMode } from '@/contexts/ThemeContext';
import { loadDiscoverCreatorSuggestions } from '@/src/services/discoverCreatorsLoad';
import {
  DISCOVER_CREATORS_COPY,
  DISCOVER_CREATORS_PROFILE_LIMIT,
  discoverCreatorsProfileSlice,
  type DiscoverCreatorSuggestion,
} from '@/src/ui/discoverCreators';
import { creatorProfileHref } from '@/src/ui/feedCreatorIdentity';

type Props = {
  excludeUserId?: string | null;
  excludeUsername?: string | null;
};

const CARD_WIDTH = 132;
const CARD_GAP = 10;

/**
 * Personal Profile rail: Discover Creators You'll Love + See more.
 * Inserted below the action row and above profile tabs — does not touch the header.
 */
export function DiscoverCreatorsSection({ excludeUserId, excludeUsername }: Props) {
  const { tokens } = useThemeMode();
  const router = useRouter();
  const [items, setItems] = useState<DiscoverCreatorSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadDiscoverCreatorSuggestions({
      excludeUserId,
      excludeUsername,
      limit: DISCOVER_CREATORS_PROFILE_LIMIT,
    })
      .then((next) => {
        if (!cancelled) setItems(discoverCreatorsProfileSlice(next));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [excludeUserId, excludeUsername]);

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
