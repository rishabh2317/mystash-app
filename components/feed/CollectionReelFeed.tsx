import { useAuth } from '@/contexts/AuthContext';
import { useIsFocused } from '@react-navigation/native';
import { ActionButton } from '@/components/ui/ActionButton';
import { listSavedCollectionIds } from '@/src/services/engagementApi';
import { createCollectionReelPageLoader } from '@/src/services/collectionReelPages';
import { listCreatorCollections } from '@/src/services/collectionApi';
import { collectionReelLoopRows, collectionReelLoopTarget, mergeCollectionReelRefs, type CollectionReelSession } from '@/src/state/collectionReelSession';
import { TopBar } from '@/components/chrome/TopBar';
import { FeedProductSheet } from '@/components/feed/FeedProductSheet';
import ReelItem from '@/components/ReelItem';
import { FailureState } from '@/components/status/FailureState';
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
  SEARCH_REEL_VIEW_SURFACE,
} from '@/src/ui/searchReelNavigation';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  StyleSheet,
  View,
  type ViewToken,
} from 'react-native';

const WINDOW_HEIGHT = Dimensions.get('window').height;
const loadPage = createCollectionReelPageLoader({creator:listCreatorCollections,saved:listSavedCollectionIds,search:searchBlended});

type ReelRow = {
  collectionId: string;
  heroThumbnailUrl: string | null;
};

/**
 * Source-scoped vertical reels using the existing ReelItem and engagement stack.
 * The entry snapshot and cursor define the dataset; Home remains independent.
 */
export default function CollectionReelFeed({sourceSession}: {sourceSession?: CollectionReelSession} = {}) {
  const {user} = useAuth();
  const router = useRouter();
  if (sourceSession?.ownerId && sourceSession.ownerId !== user?.id) return <View style={styles.root}><FailureState variant="immersive" fill title="Reopen your reels" message="Your account changed. Go back to choose a collection." actionLabel="Go back" onRetry={()=>router.back()} /></View>;
  return <CollectionReelFeedSession sourceSession={sourceSession} />;
}

function CollectionReelFeedSession({sourceSession}: {sourceSession?: CollectionReelSession}) {
  const focused = useIsFocused();
  const router = useRouter();
  const params = useLocalSearchParams<{ collectionId?: string | string[] }>();
  const startCollectionId = Array.isArray(params.collectionId)
    ? params.collectionId[0]
    : params.collectionId;

  const sessionRef = useRef(sourceSession ? {...sourceSession, query: '', entityType: undefined} : getSearchReelSession());
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
  const [moreError, setMoreError] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, boolean>>({});
  const paging = useRef(false), paginationFailed = useRef(false);
  const hydrating = useRef(new Set<string>());
  const nextCursorRef = useRef(session?.nextCursor ?? null);
  const loadGen = useRef(0);
  const listRef = useRef<FlatList<ReelRow>>(null);
  const rowsRef = useRef(rows);
  const activeIndexRef = useRef(activeIndex);
  const activeCollectionIdRef = useRef<string | undefined>(undefined);

  const itemHeight = viewportHeight > 0 ? viewportHeight : WINDOW_HEIGHT;
  const feedRows = useMemo(()=>collectionReelLoopRows(rows, nextCursorRef.current),[rows]);
  const activeRow = feedRows[activeIndex];
  const activeVideo = activeRow ? videos[activeRow.collectionId] : undefined;
  const surface = sourceSession ? 'focused_reel' : SEARCH_REEL_VIEW_SURFACE;
  const engagement = useFeedReelEngagement(activeVideo, { surface });

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 90,
    minimumViewTime: 300,
  }).current;

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
    activeCollectionIdRef.current = feedRows[activeIndex]?.collectionId;
  }, [activeIndex, rows, feedRows]);

  useEffect(() => {
    const generation = loadGen;
    return () => {
      generation.current++;
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
      if (hydrating.current.has(collectionId)) return;
      hydrating.current.add(collectionId);
      setRowErrors(prev=>({...prev,[collectionId]:false}));
      try {
        const video = await hydrateSearchReelVideo(collectionId);
        if (gen !== loadGen.current) return;
        mergeVideo(collectionId, video);
      } catch {
        if (gen !== loadGen.current) return;
        setRowErrors(prev=>({...prev,[collectionId]:true}));
      } finally { hydrating.current.delete(collectionId); }
    },
    [mergeVideo],
  );

  const hydrateAround = useCallback(
    (index: number) => {
      const gen = loadGen.current;
      const list = collectionReelLoopRows(rowsRef.current, nextCursorRef.current);
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
    if (viewportHeight <= 0) return;
    listRef.current?.scrollToOffset({offset:feedItemLayout(itemHeight,activeIndexRef.current).offset,animated:false});
  },[itemHeight,viewportHeight]);

  useEffect(() => {
    hydrateAround(activeIndex);
  }, [activeIndex, hydrateAround, feedRows.length]);

  useEffect(() => {
    const row = feedRows[activeIndex];
    if (!row || !focused) return;
    recordCollectionViewOnce({
      collectionId: row.collectionId,
      creatorId: videos[row.collectionId]?.curator_id ?? null,
      surface,
    });
  }, [activeIndex, rows, videos, focused, feedRows, surface]);

  useEffect(() => {
    const uri = nextFeedThumbnailUrl(
      feedRows.map((r) => ({
        thumbnail: videos[r.collectionId]?.thumbnail ?? r.heroThumbnailUrl,
      })),
      activeIndex,
    );
    if (!uri) return;
    void Image.prefetch(uri);
  }, [activeIndex, feedRows, videos]);

  const loadMoreCollections = useCallback(async (retry = false) => {
    const cursor = nextCursorRef.current;
    if (cursor === null || paging.current || (paginationFailed.current && !retry)) return;
    const gen = loadGen.current;
    paging.current = true; paginationFailed.current = false;
    setLoadingMore(true); setMoreError(false);
    try {
      const source = sourceSession?.source ?? {kind:'search' as const,query:session?.query??'',entityType:session?.entityType};
      const page = await loadPage(source, cursor);
      const incoming = mergeCollectionReelRefs([],page.collections), nextCursor = page.nextCursor;
      if (gen !== loadGen.current) return;
      if (nextCursor === cursor) throw Error('Pagination did not advance');
      const merged = mergeCollectionReelRefs(rowsRef.current, incoming);
      rowsRef.current = merged;
      nextCursorRef.current = nextCursor;
      if (!sourceSession) { appendSearchReelCollections(incoming); updateSearchReelCursor(nextCursor); }
      setRows(merged);
    } catch {
      if (gen === loadGen.current) { paginationFailed.current = true; setMoreError(true); }
    } finally {
      if (gen === loadGen.current) { paging.current = false; setLoadingMore(false); }
    }
  }, [session?.query, session?.entityType, sourceSession]);

  useEffect(() => {
    if (!focused || rows.length === 0) return;
    if (activeIndex >= rows.length - 2) {
      void loadMoreCollections();
    }
  }, [activeIndex, loadMoreCollections, rows, focused]);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length === 0) return;
      const { index, isViewable } = viewableItems[0];
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
      const active = index === activeIndex && focused && inspect === null;
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
              like={
                active
                  ? {
                      isLiked: engagement.isLiked,
                      pending: engagement.likePending,
                      count: engagement.likeCount,
                      onPress: () => void engagement.onLikePress(),
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
              moreFromCreator={active ? engagement.moreFromCreator : null}
            />
          ) : rowErrors[item.collectionId] ? (
            <FailureState variant="immersive" fill title="Collection unavailable" message="This reel could not be loaded. Retry or swipe to the next reel." actionLabel="Retry" onRetry={()=>void hydrateRow(item.collectionId,loadGen.current)} />
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
    [activeIndex, focused, inspect, rowErrors, hydrateRow, engagement, handleProductPress, itemHeight, videos
    ],
  );

  const keyExtractor = useCallback((item: ReelRow, index: number) => `${index}:${item.collectionId}`, []);
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
        <FailureState
          variant="immersive"
          fill
          title="Couldn't open reels"
          message={bootError ?? 'Go back and try again.'}
          actionLabel="Go back"
          onRetry={() => router.back()}
        />
        <TopBar
          mode="immersive"
          showBack
          backAccessibilityLabel="Close reels"
          onBack={() => router.back()}
        />
      </View>
    );
  }

  return (
    <View style={styles.root} onLayout={onViewportLayout}>
      <FlatList
        ref={listRef}
        data={feedRows}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        pagingEnabled
        onMomentumScrollEnd={event=>{
          const index=Math.round(event.nativeEvent.contentOffset.y/itemHeight);
          const target=collectionReelLoopTarget(index,rowsRef.current.length,nextCursorRef.current);
          if(target!==null){listRef.current?.scrollToOffset({offset:0,animated:false});setActiveIndex(target);}
        }}
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
        extraData={`${activeIndex}:${itemHeight}:${Object.keys(videos).length}:${engagement.isFollowing}:${engagement.isLiked}:${engagement.likeCount}:${engagement.isSaved}:${engagement.savesCount}:${engagement.sharesCount}:${engagement.moreFromCreator?.collectionId ?? ''}`}
        getItemLayout={getItemLayout}
        onScrollToIndexFailed={({ index }) => {
          listRef.current?.scrollToOffset({
            offset: feedItemLayout(itemHeight, index).offset,
            animated: false,
          });
        }}
      />
      {moreError?<View style={styles.pageNotice}><ActionButton label="Try loading more reels" variant="secondary" wrapLabel minTouchHeight={48} onPress={()=>void loadMoreCollections(true)}/></View>:loadingMore?<View pointerEvents="none" style={styles.pageNotice}><ActivityIndicator color="#F8FAFC"/></View>:null}
      <FeedProductSheet
        visible={inspect != null}
        video={inspect?.video ?? null}
        product={inspect?.product ?? null}
        onClose={() => setInspect(null)}
      />
      <TopBar
        mode="immersive"
        showBack
        backAccessibilityLabel="Close reels"
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
  pageNotice: { position: 'absolute', bottom: 112, alignSelf: 'center', maxWidth: '90%' },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#05070A',
  },
});
