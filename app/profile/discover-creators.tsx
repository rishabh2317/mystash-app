import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  View,
} from 'react-native';

import { TopBar } from '@/components/chrome/TopBar';
import { DiscoverCreatorSuggestionCard } from '@/components/creator/DiscoverCreatorSuggestionCard';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { loadDiscoverCreatorSuggestions } from '@/src/services/discoverCreatorsLoad';
import { pageCanvasGradient } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import {
  DISCOVER_CREATORS_COPY,
  DISCOVER_CREATORS_PAGE_LIMIT,
  discoverCreatorsPageSlice,
  type DiscoverCreatorSuggestion,
} from '@/src/ui/discoverCreators';
import { creatorProfileHref } from '@/src/ui/feedCreatorIdentity';

/**
 * Full-screen Discover Creators list (max 15). Reuses Home-feed creator seeds —
 * no new recommendation backend.
 */
export default function DiscoverCreatorsScreen() {
  const router = useRouter();
  const { tokens } = useThemeMode();
  const { user } = useAuth();
  const [items, setItems] = useState<DiscoverCreatorSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadDiscoverCreatorSuggestions({
      excludeUserId: user?.id ?? null,
      excludeUsername: null,
      limit: DISCOVER_CREATORS_PAGE_LIMIT,
    })
      .then((next) => {
        if (!cancelled) setItems(discoverCreatorsPageSlice(next));
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
  }, [user?.id]);

  const onPressCreator = useCallback(
    (username: string) => {
      router.push(creatorProfileHref(username) as Href);
    },
    [router],
  );

  const bg = [...pageCanvasGradient(tokens), tokens.color.canvas] as const;

  return (
    <View style={styles.root}>
      <LinearGradient colors={[...bg]} style={StyleSheet.absoluteFill} />
      <TopBar mode="page" title={DISCOVER_CREATORS_COPY.title} showBack showBag={false} />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={tokens.color.text} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.centered}>
          <Text style={[typeStyle(tokens, 'bodyMuted'), { textAlign: 'center' }]}>
            No creators to discover yet. Check back as the feed grows.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.creator.userId}
          contentContainerStyle={{
            paddingHorizontal: tokens.space.md,
            paddingTop: tokens.space.sm,
            paddingBottom: tokens.space.xxl,
            gap: tokens.space.sm,
          }}
          renderItem={({ item }) => (
            <DiscoverCreatorSuggestionCard
              suggestion={item}
              variant="detail"
              onPressCreator={onPressCreator}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
});
