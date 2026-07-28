import ReelItem from '@/components/ReelItem';
import { ThemedText } from '@/components/themed-text';
import type { Video } from '@/src/mocks/videos';
import { subscribeFeedReload } from '@/src/services/feedRefresh';
import { fetchVideos } from '@/src/services/supabase';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Linking,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function HomeScreen() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const hasLoadedOnce = useRef(false);
  const listRef = useRef<FlatList<Video>>(null);
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 90,
    minimumViewTime: 300,
  }).current;

  const scrollFeedToTop = useCallback(() => {
    setActiveIndex(0);
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    });
  }, []);

  const applyVideoRows = useCallback(
    (supabaseVideos: Video[]) => {
      setVideos(supabaseVideos);
      setLoadError(null);
      scrollFeedToTop();
    },
    [scrollFeedToTop],
  );

  const loadFromSupabase = useCallback(
    async (opts: { showFullScreenSpinner: boolean; isCancelled?: () => boolean }) => {
      const { showFullScreenSpinner, isCancelled } = opts;
      try {
        if (showFullScreenSpinner) setLoading(true);
        const supabaseVideos = await fetchVideos();
        if (isCancelled?.()) return;
        applyVideoRows(supabaseVideos);
      } catch (error) {
        if (isCancelled?.()) return;
        console.error('Error loading videos:', error);
        const msg = error instanceof Error ? error.message : 'Could not load the feed.';
        setLoadError(msg);
        setVideos([]);
      } finally {
        setRefreshing(false);
        if (isCancelled?.()) return;
        hasLoadedOnce.current = true;
        if (showFullScreenSpinner) setLoading(false);
      }
    },
    [applyVideoRows],
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const showSpinner = !hasLoadedOnce.current;

      void (async () => {
        await loadFromSupabase({
          showFullScreenSpinner: showSpinner,
          isCancelled: () => cancelled,
        });
      })();

      return () => {
        cancelled = true;
      };
    }, [loadFromSupabase]),
  );

  useEffect(() => {
    return subscribeFeedReload(() => {
      void loadFromSupabase({ showFullScreenSpinner: false });
    });
  }, [loadFromSupabase]);

  const onViewableItemsChanged = useRef(({ changed, viewableItems }: any) => {
    if (changed.length > 0) {
      const { index, isViewable } = changed[0];

      if (isViewable) {
        setActiveIndex(index);

        viewableItems.forEach((viewableItem: any) => {
          if (viewableItem.isViewable && viewableItem.index !== index) {
            console.log(`Pausing video at index ${viewableItem.index}`);
          }
        });
      }
    }
  }).current;

  const handleBuyPress = useCallback(async (video: Video) => {
    const linked = video.products?.find((p) => p.affiliate_url);
    if (linked?.affiliate_url) {
      try {
        await Linking.openURL(linked.affiliate_url);
      } catch {
        Alert.alert('Error', 'Could not open the affiliate link.');
      }
      return;
    }
    Alert.alert(
      'Stash it',
      `${video.product_name}\nCreator: ${video.creator_name}\nOpen the product list to shop this reel.`,
      [{ text: 'OK' }],
    );
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: Video; index: number }) => (
      <ReelItem video={item} isActive={index === activeIndex} onBuyPress={handleBuyPress} />
    ),
    [activeIndex, handleBuyPress],
  );

  const keyExtractor = useCallback((item: Video) => item.id, []);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
        <ThemedText style={{ marginTop: 16 }}>Loading amazing products...</ThemedText>
      </View>
    );
  }

  if (videos.length === 0) {
    return (
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadFromSupabase({ showFullScreenSpinner: false });
            }}
          />
        }
      >
        <ThemedText style={{ fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 8 }}>
          No reels in your feed yet
        </ThemedText>
        <ThemedText style={{ fontSize: 14, textAlign: 'center', opacity: 0.85, marginBottom: 20 }}>
          {loadError
            ? loadError
            : 'Publish from the Create tab. If rows exist in Supabase but you see this message, apply the migration that adds public read on `videos` (RLS), then pull to refresh.'}
        </ThemedText>
        <TouchableOpacity
          onPress={() => {
            setRefreshing(true);
            void loadFromSupabase({ showFullScreenSpinner: false });
          }}
          style={{ alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 20 }}
        >
          <Text style={{ color: '#0EA5E9', fontWeight: '700', fontSize: 16 }}>Retry</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <FlatList
      ref={listRef}
      data={videos}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      pagingEnabled={true}
      snapToInterval={SCREEN_HEIGHT}
      decelerationRate="fast"
      viewabilityConfig={viewabilityConfig}
      onViewableItemsChanged={onViewableItemsChanged}
      showsVerticalScrollIndicator={false}
      removeClippedSubviews={true}
      maxToRenderPerBatch={3}
      windowSize={5}
      initialNumToRender={1}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void loadFromSupabase({ showFullScreenSpinner: false });
          }}
        />
      }
      getItemLayout={(data, index) => ({
        length: SCREEN_HEIGHT,
        offset: SCREEN_HEIGHT * index,
        index,
      })}
    />
  );
}
