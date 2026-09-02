import { TopBar } from '@/components/chrome/TopBar';
import { FeedProductSheet } from '@/components/feed/FeedProductSheet';
import ReelItem from '@/components/ReelItem';
import { StatusBlock } from '@/components/status/StatusBlock';
import type { Product, Video } from '@/src/mocks/videos';
import { recordCollectionViewOnce } from '@/src/services/collectionViewTracking';
import { useFeedReelEngagement } from '@/src/services/feedReelEngagement';
import {
  clearSearchReelVideoCache,
  hydrateSearchReelVideo,
  peekSearchReelVideo,
} from '@/src/services/searchReelHydration';
import { searchBlended } from '@/src/services/searchApi';
import {
  appendSearchReelCollections,
  getSearchReelSession,
  initialSearchReelIndex,
  updateSearchReelCursor,
} from '@/src/state/searchReelSession';
import { feedItemLayout, nextFeedThumbnailUrl } from '@/src/ui/feedViewport';
import {
  collectionRefsFromSearchResults,
  SEARCH_REEL_VIEW_SURFACE,
} from '@/src/ui/searchReelNavigation';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  StyleSheet,
  View,
  type ViewToken,
} from 'react-native';

const WINDOW_HEIGHT = Dimensions.get('window').height;
const PAGE_LIMIT = 20;

type ReelRow = {
  collectionId: string;
  heroThumbnailUrl: string | null;
};

/**
 * Search-scoped vertical Reel feed — same ReelItem stack as Home,
 * dataset = Collection hits from the active typed Search session only.
 */
export default function SearchReelFeedHost() {
  const router = useRouter();
  const params = useLocalSearchParams<{ collectionId?: string | string[] }>();
  const startCollectionId = Array.isArray(params.collectionId)
    ? params.collectionId[0]
    : params.collectionId;

  const sessionRef = useRef(getSearchReelSession());
  const session = sessionRef.current;

  const [rows, setRows] = useState<ReelRow[]>(() =>
    session ? session.collections.map((c) => ({ ...c })) : [],
  );
  const [videos, setVideos] = useState<Record<string, Video>>({});
  const [activeIndex, setActiveIndex] = useState(() =>
    session && startCollectionId
      ? initialSearchReelIndex(session, startCollectionId)
      : 0,
  );
  const [viewportHeight, setViewportHeight] = useState(0);
  const [bootError, setBootError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const nextCursorRef = useRef(session?.nextCursor ?? null);
  const loadGen = useRef(0);
  const listRef = useRef<FlatList<ReelRow>>(null);
  const rowsRef = useRef(rows);
  const activeIndexRef = useRef(activeIndex);
  const activeCollectionIdRef = useRef<string | undefined>(undefined);

  const itemHeight = viewportHeight > 0 ? viewportHeight : WINDOW_HEIGHT;
  const activeRow = rows[activeIndex];
  const activeVideo = activeRow ? videos[activeRow.collectionId] : undefined;
  const engagement = useFeedReelEngagement(activeVideo, { surface: SEARCH_REEL_VIEW_SURFACE });

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 90,
    minimumViewTime: 300,
  }).current;

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
    activeCollectionIdRef.current = rows[activeIndex]?.collectionId;
  }, [activeIndex, rows]);

  useEffect(() => {
    return () => {
      clearSearchReelVideoCache();
    };
  }, []);

  const mergeVideo = useCallback((collectionId: string, video: Video) => {
    setVideos((prev) => {
      if (prev[collectionId] === video) return prev;
      return { ...prev, [collectionId]: video };
    });
  }, []);

  const hydrateRow = useCallback(
    async (collectionId: string, gen: number) => {
      const cached = peekSearchReelVideo(collectionId);
      if (cached) {
        mergeVideo(collectionId, cached);
        return;
      }
      try {
        const video = await hydrateSearchReelVideo(collectionId);
        if (gen !== loadGen.current) return;
        mergeVideo(collectionId, video);
      } catch {
        if (gen !== loadGen.current) return;
        setBootError('Could not load this collection');
      }
    },
    [mergeVideo],
  );

  const hydrateAround = useCallback(
    (index: number) => {
      const gen = loadGen.current;
      const list = rowsRef.current;
      const targets = [index, index - 1, index + 1].filter(
        (i) => i >= 0 && i < list.length,
      );
      for (const i of targets) {
        const id = list[i]?.collectionId;
        if (id) void hydrateRow(id, gen);
      }
    },
    [hydrateRow],
  );

  useEffect(() => {
    if (!session || !startCollectionId) {
      setBootError('Search session expired');
      return;
    }
    if (rows.length === 0) {
      setBootError('No collections in this search');
      return;
    }
    setBootError(null);
    hydrateAround(activeIndex);
    requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToIndex({ index: activeIndex, animated: false });
      } catch {
        listRef.current?.scrollToOffset({
          offset: feedItemLayout(itemHeight, activeIndex).offset,
          animated: false,
        });
      }
    });
    // Once per mount — session snapshot is fixed at entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    hydrateAround(activeIndex);
  }, [activeIndex, hydrateAround, rows.length]);

  useEffect(() => {
    const row = rows[activeIndex];
    if (!row) return;
    recordCollectionViewOnce({
      collectionId: row.collectionId,
      creatorId: videos[row.collectionId]?.curator_id ?? null,
      surface: SEARCH_REEL_VIEW_SURFACE,
    });
  }, [activeIndex, rows, videos]);

  useEffect(() => {
    const uri = nextFeedThumbnailUrl(
      rows.map((r) => ({
        thumbnail: videos[r.collectionId]?.thumbnail ?? r.heroThumbnailUrl,
      })),
      activeIndex,
    );
    if (!uri) return;
    void Image.prefetch(uri);
  }, [activeIndex, rows, videos]);

  const loadMoreCollections = useCallback(async () => {
    const query = session?.query?.trim();
    const cursor = nextCursorRef.current;
    if (!query || !cursor || loadingMore) return;

    setLoadingMore(true);
    try {
      const res = await searchBlended({
        q: query,
        presentation: 'typed',
        limit: PAGE_LIMIT,
        cursor,
      });
      const nextRefs = collectionRefsFromSearchResults(
        res.results,
        rowsRef.current.map((r) => ({
          collectionId: r.collectionId,
          heroThumbnailUrl: r.heroThumbnailUrl,
        })),
      );
      const appended = nextRefs.slice(rowsRef.current.length);
      if (appended.length > 0) {
        appendSearchReelCollections(appended);
        setRows((prev) => {
          const merged = [...prev];
          for (const ref of appended) {
            if (!merged.some((r) => r.collectionId === ref.collectionId)) {
              merged.push(ref);
            }
          }
          return merged;
        });
      }
      nextCursorRef.current = res.nextCursor;
      updateSearchReelCursor(res.nextCursor);
    } catch {
      /* pagination must not block the feed */
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, session?.query]);

  useEffect(() => {
    if (rows.length === 0) return;
    if (activeIndex >= rows.length - 2) {
      void loadMoreCollections();
    }
  }, [activeIndex, loadMoreCollections, rows.length]);

  const onViewableItemsChanged = useRef(
    ({ changed }: { changed: ViewToken[] }) => {
      if (changed.length === 0) return;
      const { index, isViewable } = changed[0];
      if (isViewable && typeof index === 'number' && index >= 0) {
        setActiveIndex(index);
      }
    },
  ).current;

  const [inspect, setInspect] = useState<{ video: Video; product: Product } | null>(null);

  const handleProductPress = useCallback((video: Video, product: Product) => {
    setInspect({ video, product });
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: ReelRow; index: number }) => {
      const active = index === activeIndex;
      const video = videos[item.collectionId];
      return (
        <View style={{ height: itemHeight, width: '100%' }}>
          {video ? (
            <ReelItem
              video={video}
              isActive={active}
              onProductPress={(product) => handleProductPress(video, product)}
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
                      onPress: () => void engagement.onSavePress(),
                    }
                  : null
              }
              share={
                active && engagement.canSaveShare
                  ? {
                      onPress: () => void engagement.onSharePress(),
                      accessibilityLabel: 'Share collection',
                    }
                  : null
              }
              creatorAvatarUrl={active ? engagement.avatarUrl : undefined}
              creatorUsername={active ? engagement.username : undefined}
              creatorDisplayName={active ? engagement.displayName : undefined}
            />
          ) : (
            <View style={styles.placeholder}>
              {item.heroThumbnailUrl ? (
                <Image
                  source={{ uri: item.heroThumbnailUrl }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                />
              ) : (
                <LinearGradient
                  colors={['#05070A', '#0A0E14', '#05070A']}
                  style={StyleSheet.absoluteFill}
                />
              )}
              <ActivityIndicator color="#F8FAFC" />
            </View>
          )}
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
      engagement.showFollow,
      engagement.username,
      handleProductPress,
      itemHeight,
      videos,
    ],
  );

  const keyExtractor = useCallback((item: ReelRow) => item.collectionId, []);
  const getItemLayout = useCallback(
    (_data: ArrayLike<ReelRow> | null | undefined, index: number) =>
      feedItemLayout(itemHeight, index),
    [itemHeight],
  );

  const onViewportLayout = (event: { nativeEvent: { layout: { height: number } } }) => {
    const next = Math.round(event.nativeEvent.layout.height);
    if (next > 0 && next !== viewportHeight) setViewportHeight(next);
  };

  if (!session || bootError) {
    return (
      <View style={styles.root} onLayout={onViewportLayout}>
        <StatusBlock
          kind="error"
          fill
          title="Couldn't open search results"
          message={bootError ?? 'Go back and try again.'}
          actionLabel="Back to Search"
          onAction={() => router.back()}
        />
        <TopBar
          mode="immersive"
          showBack
          backAccessibilityLabel="Back to search"
          onBack={() => router.back()}
        />
      </View>
    );
  }

  return (
    <View style={styles.root} onLayout={onViewportLayout}>
      <FlatList
        ref={listRef}
        data={rows}
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
        initialScrollIndex={activeIndex}
        extraData={`${activeIndex}:${itemHeight}:${Object.keys(videos).length}:${engagement.isFollowing}:${engagement.isSaved}`}
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
      <TopBar
        mode="immersive"
        showBack
        backAccessibilityLabel="Back to search"
        onBack={() => router.back()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#05070A',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#05070A',
  },
});
