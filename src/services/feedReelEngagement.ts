import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { mapAggregateToFeedCollectionContext } from '@/src/mappers/feedCollectionContext';
import type { FeedCollectionContext } from '@/src/mappers/feedCollectionContext';
import type { Video } from '@/src/mocks/videos';
import { fetchCollectionById } from '@/src/services/collectionApi';
import { useCollectionSaveHandler } from '@/src/services/collectionSaveOrchestration';
import { useCreatorFollowHandler } from '@/src/services/creatorFollowOrchestration';
import { isCollectionSaved, isFollowingCreator } from '@/src/services/engagementApi';
import { shareCollection } from '@/src/services/shareLinks';
import {
  creatorDisplayNameFromFeed,
  creatorUsernameFromFeed,
  shouldShowFeedFollow,
} from '@/src/ui/feedCreatorIdentity';

const contextCache = new Map<string, FeedCollectionContext>();

/**
 * Lazy per-active-reel Collection identity for Home / Search Reel.
 * Does not prefetch the whole feed. Follow stays hidden until creator UUID resolves.
 */
export function useFeedReelEngagement(
  video: Video | undefined,
  opts?: { surface?: string },
) {
  const engagementSurface = opts?.surface ?? 'home_reel';
  const { user } = useAuth();
  const collectionId = video?.collection_id?.trim() || '';
  const [context, setContext] = useState<FeedCollectionContext | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followPending, setFollowPending] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (!collectionId) {
      setContext(null);
      return;
    }
    const cached = contextCache.get(collectionId);
    if (cached) {
      setContext(cached);
      return;
    }
    const id = ++requestId.current;
    let cancelled = false;
    void fetchCollectionById(collectionId)
      .then((aggregate) => {
        const next = mapAggregateToFeedCollectionContext(aggregate);
        contextCache.set(collectionId, next);
        if (!cancelled && requestId.current === id) setContext(next);
      })
      .catch(() => {
        if (!cancelled && requestId.current === id) setContext(null);
      });
    return () => {
      cancelled = true;
    };
  }, [collectionId]);

  useEffect(() => {
    if (!user || !collectionId) {
      setIsSaved(false);
      return;
    }
    let cancelled = false;
    void isCollectionSaved(collectionId)
      .then((next) => {
        if (!cancelled) setIsSaved(next);
      })
      .catch(() => {
        if (!cancelled) setIsSaved(false);
      });
    return () => {
      cancelled = true;
    };
  }, [collectionId, user]);

  const creatorId = context?.creator.id?.trim() || '';

  useEffect(() => {
    if (!user || !creatorId) {
      setIsFollowing(false);
      return;
    }
    let cancelled = false;
    void isFollowingCreator(creatorId)
      .then((next) => {
        if (!cancelled) setIsFollowing(next);
      })
      .catch(() => {
        if (!cancelled) setIsFollowing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [creatorId, user]);

  const username =
    context?.creator.username ?? (video ? creatorUsernameFromFeed(video) : null);
  const displayName =
    context?.creator.displayName ?? (video ? creatorDisplayNameFromFeed(video) : 'Creator');
  const avatarUrl = context?.creator.avatarUrl ?? null;
  const isSelf = Boolean(user && creatorId && user.id === creatorId);

  const saveHandler = useCollectionSaveHandler({
    collectionId,
    creatorId: creatorId || null,
    isSaved,
    onOptimisticSave: (next) => {
      setSavePending(true);
      setIsSaved(next);
    },
    onRollback: (previous) => {
      setIsSaved(previous);
      setSavePending(false);
    },
  });

  const followHandler = useCreatorFollowHandler({
    creatorId,
    username: username ?? '',
    isSelf,
    isFollowing,
    onOptimisticFollow: (next) => {
      setFollowPending(true);
      setIsFollowing(next);
    },
    onRollback: (previous) => {
      setIsFollowing(previous);
      setFollowPending(false);
    },
  });

  const onSavePress = useCallback(async () => {
    if (!collectionId) return;
    setSavePending(true);
    try {
      await saveHandler();
    } finally {
      setSavePending(false);
    }
  }, [collectionId, saveHandler]);

  const onFollowPress = useCallback(async () => {
    if (!creatorId) {
      Alert.alert('Follow', 'Open this creator profile to follow.');
      return;
    }
    try {
      await followHandler();
    } finally {
      setFollowPending(false);
    }
  }, [creatorId, followHandler]);

  const onSharePress = useCallback(async () => {
    if (!collectionId) return;
    try {
      await shareCollection({
        collectionId,
        title: context?.title ?? video?.video_title ?? video?.product_name ?? null,
        creatorId: creatorId || null,
        surface: engagementSurface,
      });
    } catch (e) {
      Alert.alert('Share', e instanceof Error ? e.message : 'Could not share collection.');
    }
  }, [collectionId, context?.title, creatorId, engagementSurface, video?.product_name, video?.video_title]);

  return {
    collectionId,
    username,
    displayName,
    avatarUrl,
    isSelf,
    showFollow: shouldShowFeedFollow({ creatorId, isSelf }),
    isFollowing,
    followPending,
    onFollowPress,
    canSaveShare: Boolean(collectionId),
    isSaved,
    savePending,
    onSavePress,
    onSharePress,
  };
}
