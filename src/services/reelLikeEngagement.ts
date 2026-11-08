import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import type { Video } from '@/src/mocks/videos';
import {
  getReelLikeSummary,
  likeReel,
  unlikeReel,
  type ReelLikeSummary,
} from '@/src/services/engagementApi';
import { optimisticReelLike, reconcileVisibleLike } from '@/src/ui/reelLikes';

const cache = new Map<string, ReelLikeSummary>();

function cacheKey(reelId: string, userId?: string | null): string {
  return `${userId ?? 'anonymous'}:${reelId}`;
}

/** Active-Reel Like state. Reel identity is videos.id, never its Collection ID. */
export function useReelLikeEngagement(
  video: Video | undefined,
  surface = 'home_reel',
) {
  const router = useRouter();
  const { user } = useAuth();
  const reelId = video?.id?.trim() ?? '';
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [likePending, setLikePending] = useState(false);
  const requestId = useRef(0);
  const pendingRef = useRef(false);
  const visibleRef = useRef<ReelLikeSummary>({ liked: false, likeCount: 0 });
  const confirmedRef = useRef<ReelLikeSummary>({ liked: false, likeCount: 0 });

  useEffect(() => {
    const id = ++requestId.current;
    pendingRef.current = false;
    setLikePending(false);
    if (!reelId) {
      visibleRef.current = { liked: false, likeCount: 0 };
      confirmedRef.current = visibleRef.current;
      setLiked(false);
      setLikeCount(0);
      return;
    }

    const key = cacheKey(reelId, user?.id);
    const cached = cache.get(key);
    visibleRef.current = cached ?? { liked: false, likeCount: 0 };
    confirmedRef.current = cached ?? { liked: false, likeCount: 0 };
    if (cached) {
      setLiked(cached.liked);
      setLikeCount(cached.likeCount);
    } else {
      setLiked(false);
      setLikeCount(0);
    }

    let cancelled = false;
    void getReelLikeSummary(reelId)
      .then((summary) => {
        if (cancelled || requestId.current !== id) return;
        confirmedRef.current = summary;
        if (!pendingRef.current) {
          visibleRef.current = summary;
          cache.set(key, summary);
          setLiked(summary.liked);
          setLikeCount(summary.likeCount);
        }
      })
      .catch(() => {
        if (cancelled || requestId.current !== id || cached || pendingRef.current) return;
        setLiked(false);
        setLikeCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [reelId, user?.id]);

  const onLikePress = useCallback(async () => {
    if (!reelId) return;
    if (!user) {
      Alert.alert('Like Reel', 'Sign in to like Reels.');
      router.push('/(tabs)/profile');
      return;
    }

    const optimistic = optimisticReelLike(visibleRef.current);
    visibleRef.current = optimistic;
    const key = cacheKey(reelId, user.id);
    setLiked(optimistic.liked);
    setLikeCount(optimistic.likeCount);
    cache.set(key, optimistic);
    if (pendingRef.current) return;
    const id = ++requestId.current;
    pendingRef.current = true;
    setLikePending(true);

    try {
      while (confirmedRef.current.liked !== visibleRef.current.liked) {
        const target = visibleRef.current.liked;
        const confirmed = target
          ? await likeReel(reelId, surface)
          : await unlikeReel(reelId, surface);
        if (requestId.current !== id) return;
        confirmedRef.current = confirmed;
        const next = reconcileVisibleLike(confirmed, visibleRef.current.liked);
        visibleRef.current = next;
        cache.set(key, next);
        setLiked(next.liked);
        setLikeCount(next.likeCount);
      }
    } catch (error) {
      if (requestId.current !== id) return;
      const actual = await getReelLikeSummary(reelId).catch(() => confirmedRef.current);
      if (requestId.current !== id) return;
      confirmedRef.current = actual;
      visibleRef.current = actual;
      cache.set(key, actual);
      setLiked(actual.liked);
      setLikeCount(actual.likeCount);
      Alert.alert(
        'Like Reel',
        error instanceof Error ? error.message : 'Could not update this Like.',
      );
    } finally {
      if (requestId.current === id) {
        pendingRef.current = false;
        setLikePending(false);
      }
    }
  }, [reelId, router, surface, user]);

  return {
    reelId,
    liked,
    likeCount,
    likePending,
    onLikePress,
  };
}
