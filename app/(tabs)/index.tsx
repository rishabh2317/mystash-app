import { TopBar } from '@/components/chrome/TopBar';
import { FeedProductSheet } from '@/components/feed/FeedProductSheet';
import { FeedTeachHint } from '@/components/feed/FeedTeachHint';
import ReelItem from '@/components/ReelItem';
import { StatusBlock } from '@/components/status/StatusBlock';
import { useThemeMode } from '@/contexts/ThemeContext';
import type { Product, Video } from '@/src/mocks/videos';
import { recordCollectionViewOnce } from '@/src/services/collectionViewTracking';
import { dismissFeedTeach, readFeedTeachDismissed } from '@/src/services/feedTeach';
import { useFeedReelEngagement } from '@/src/services/feedReelEngagement';
import { subscribeFeedReload } from '@/src/services/feedRefresh';
import { fetchVideos } from '@/src/services/supabase';
import {
  classifyFeedLoadFailure,
  FEED_COPY,
  feedFailureCopy,
  type FeedFailureKind,
} from '@/src/ui/feedLoadState';
import {
  feedReelAnnouncement,
  shouldShowFeedTeach,
} from '@/src/ui/feedA11y';
import { feedItemLayout, nextFeedThumbnailUrl, preserveFeedIndex } from '@/src/ui/feedViewport';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { Image } from 'expo-image';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';

const WINDOW_HEIGHT = Dimensions.get('window').height;

export default function HomeScreen() {
  const { tokens } = useThemeMode();
  const tabBarHeight = useBottomTabBarHeight();
  const [activeIndex, setActiveIndex] = useState(0);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failureKind, setFailureKind] = useState<FeedFailureKind | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [teachDismissed, setTeachDismissed] = useState<boolean | null>(null);
  const hasLoadedOnce = useRef(false);
  const videosRef = useRef<Video[]>([]);
  const activeVideoIdRef = useRef<string | undefined>(undefined);
  const activeIndexRef = useRef(0);
  const listRef = useRef<FlatList<Video>>(null);
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 90,
    minimumViewTime: 300,
  }).current;

  const itemHeight = viewportHeight > 0 ? viewportHeight : WINDOW_HEIGHT;
  const activeVideo = videos[activeIndex];
  const engagement = useFeedReelEngagement(activeVideo);

  const applyVideoRows = useCallback(
    (next: Video[]) => {
      const nextIndex = preserveFeedIndex({
        previousId: activeVideoIdRef.current,
        previousIndex: activeIndexRef.current,
        nextIds: next.map((row) => row.id),
      });
      videosRef.current = next;
      setVideos(next);
      setActiveIndex(nextIndex);
      setFailureKind(null);
      if (hasLoadedOnce.current && next.length > 0) {
        requestAnimationFrame(() => {
          try {
            listRef.current?.scrollToIndex({ index: nextIndex, animated: false });
          } catch {
            listRef.current?.scrollToOffset({
              offset: feedItemLayout(itemHeight, nextIndex).offset,
              animated: false,
            });
          }
        });
      }
    },
    [itemHeight],
  );

  const loadFromSupabase = useCallback(
    async (opts: { showFullScreenSpinner: boolean; isCancelled?: () => boolean }) => {
      const { showFullScreenSpinner, isCancelled } = opts;
      try {
        if (showFullScreenSpinner) setLoading(true);
        const rows = await fetchVideos();
        if (isCancelled?.()) return;
        applyVideoRows(rows);
      } catch (error) {
        if (isCancelled?.()) return;
        const kind = classifyFeedLoadFailure(error);
        if (hasLoadedOnce.current && videosRef.current.length > 0) {
          setFailureKind(null);
        } else {
          setFailureKind(kind);
          videosRef.current = [];
          setVideos([]);
        }
      } finally {
        setRefreshing(false);
        if (isCancelled?.()) return;
        hasLoadedOnce.current = true;
        if (showFullScreenSpinner) setLoading(false);
      }
    },
    [applyVideoRows],
  );

  useEffect(() => {
    let cancelled = false;
    void loadFromSupabase({
      showFullScreenSpinner: true,
      isCancelled: () => cancelled,
    });
    return () => {
      cancelled = true;
    };
    // Once: switching tabs must not refetch or jump to item 0.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return subscribeFeedReload(() => {
      void loadFromSupabase({ showFullScreenSpinner: false });
    });
  }, [loadFromSupabase]);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
    activeVideoIdRef.current = videos[activeIndex]?.id;
  }, [activeIndex, videos]);

  /** Same Collection view path as /collection and /reel — identity is video.collection_id only. */
  useEffect(() => {
    const video = videos[activeIndex];
    if (!video) return;
    const collectionId = video.collection_id?.trim();
    if (!collectionId) return;
    recordCollectionViewOnce({
      collectionId,
      creatorId: video.curator_id ?? null,
      surface: 'home_reel',
    });
  }, [activeIndex, videos]);

  useEffect(() => {
    const uri = nextFeedThumbnailUrl(videos, activeIndex);
    if (!uri) return;
    void Image.prefetch(uri);
  }, [activeIndex, videos]);

  useEffect(() => {
    void readFeedTeachDismissed().then(setTeachDismissed);
  }, []);

  const persistTeachDismiss = useCallback(() => {
    setTeachDismissed(true);
    void dismissFeedTeach();
  }, []);

  useEffect(() => {
    if (activeIndex > 0 && teachDismissed === false) persistTeachDismiss();
  }, [activeIndex, persistTeachDismiss, teachDismissed]);

  const [inspect, setInspect] = useState<{ video: Video; product: Product } | null>(null);

  const onViewableItemsChanged = useRef(
    ({ changed }: { changed: ViewToken[] }) => {
      if (changed.length === 0) return;
      const { index, isViewable } = changed[0];
      if (isViewable && typeof index === 'number' && index >= 0) {
        setActiveIndex(index);
      }
    },
  ).current;

  const handleProductPress = useCallback((video: Video, product: Product) => {
    setInspect({ video, product });
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadFromSupabase({ showFullScreenSpinner: false });
  }, [loadFromSupabase]);

  const renderItem = useCallback(
    ({ item, index }: { item: Video; index: number }) => {
      const active = index === activeIndex;
      return (
        <View style={{ height: itemHeight, width: '100%' }}>
          <ReelItem
            video={item}
            isActive={active}
            onProductPress={(product) => handleProductPress(item, product)}
            bottomChromeInset={tabBarHeight}
            follow={
              active && engagement.showFollow
                ? {
                    isFollowing: engagement.isFollowing,
                    pending: engagement.followPending,
                    onPress: () => void engagement.onFollowPress(),
                  }
                : null
            }
            save={
              active && engagement.canSaveShare
                ? {
                    isSaved: engagement.isSaved,
                    pending: engagement.savePending,
                    count: engagement.savesCount,
                    onPress: () => void engagement.onSavePress(),
                  }
                : null
            }
            share={
              active && engagement.canSaveShare
                ? {
                    count: engagement.sharesCount,
                    onPress: () => void engagement.onSharePress(),
                    accessibilityLabel: 'Share collection',
                  }
                : null
            }
            creatorAvatarUrl={active ? engagement.avatarUrl : undefined}
            creatorUsername={active ? engagement.username : undefined}
            creatorDisplayName={active ? engagement.displayName : undefined}
          />
        </View>
      );
    },
    [
      activeIndex,
      engagement.avatarUrl,
      engagement.canSaveShare,
      engagement.displayName,
      engagement.followPending,
      engagement.isFollowing,
      engagement.isSaved,
      engagement.onFollowPress,
      engagement.onSavePress,
      engagement.onSharePress,
      engagement.savePending,
      engagement.savesCount,
      engagement.sharesCount,
      engagement.showFollow,
      engagement.username,
      handleProductPress,
      itemHeight,
      tabBarHeight,
    ],
  );

  const keyExtractor = useCallback((item: Video) => item.id, []);
  const getItemLayout = useCallback(
    (_data: ArrayLike<Video> | null | undefined, index: number) => feedItemLayout(itemHeight, index),
    [itemHeight],
  );

  const announcement = feedReelAnnouncement({
    title: activeVideo?.video_title || activeVideo?.product_name,
    creatorName: engagement.displayName,
  });
  const showTeach = shouldShowFeedTeach({
    dismissed: teachDismissed,
    activeIndex,
    feedReady: !loading && videos.length > 0,
  });

  const chrome = <TopBar mode="immersive" showBack={false} />;

  const retry = () => {
    const showSpinner = !hasLoadedOnce.current || videosRef.current.length === 0;
    if (showSpinner) setLoading(true);
    setRefreshing(true);
    void loadFromSupabase({ showFullScreenSpinner: showSpinner });
  };

  const onViewportLayout = (event: { nativeEvent: { layout: { height: number } } }) => {
    const next = Math.round(event.nativeEvent.layout.height);
    if (next > 0 && next !== viewportHeight) setViewportHeight(next);
  };

  if (loading) {
    return (
      <View style={{ flex: 1 }} onLayout={onViewportLayout}>
        <StatusBlock kind="loading" fill message={FEED_COPY.loadingMessage} />
        {chrome}
      </View>
    );
  }

  if (videos.length === 0) {
    const copy = failureKind ? feedFailureCopy(failureKind) : FEED_COPY.empty;
    return (
      <View style={{ flex: 1 }} onLayout={onViewportLayout}>
        <StatusBlock
          kind={failureKind ? 'error' : 'empty'}
          fill
          title={copy.title}
          message={copy.message}
          actionLabel={copy.actionLabel}
          onAction={retry}
        />
        {chrome}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }} onLayout={onViewportLayout}>
      <FlatList
        ref={listRef}
        data={videos}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        pagingEnabled
        snapToInterval={itemHeight}
        snapToAlignment="start"
        disableIntervalMomentum
        decelerationRate="fast"
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        maxToRenderPerBatch={2}
        windowSize={3}
        initialNumToRender={1}
        extraData={`${activeIndex}:${itemHeight}:${engagement.showFollow}:${engagement.isFollowing}:${engagement.isSaved}:${engagement.savesCount}:${engagement.sharesCount}`}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={tokens.color.primary}
          />
        }
        getItemLayout={getItemLayout}
        onScrollToIndexFailed={({ index }) => {
          listRef.current?.scrollToOffset({
            offset: feedItemLayout(itemHeight, index).offset,
            animated: false,
          });
        }}
      />
      <FeedProductSheet
        visible={inspect != null}
        video={inspect?.video ?? null}
        product={inspect?.product ?? null}
        onClose={() => setInspect(null)}
      />
      {announcement ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="text"
          style={styles.srOnly}
        >
          {announcement}
        </Text>
      ) : null}
      <FeedTeachHint visible={showTeach} onDismiss={persistTeachDismiss} />
      {chrome}
    </View>
  );
}

const styles = StyleSheet.create({
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
});
