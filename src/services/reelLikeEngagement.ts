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
import { optimisticReelLike } from '@/src/ui/reelLikes';

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

  useEffect(() => {
    const id = ++requestId.current;
    pendingRef.current = false;
    setLikePending(false);
    if (!reelId) {
      setLiked(false);
      setLikeCount(0);
      return;
    }

    const key = cacheKey(reelId, user?.id);
    const cached = cache.get(key);
    if (cached) {
      setLiked(cached.liked);
      setLikeCount(cached.likeCount);
    }

    let cancelled = false;
    void getReelLikeSummary(reelId)
      .then((summary) => {
        if (cancelled || requestId.current !== id) return;
        cache.set(key, summary);
        setLiked(summary.liked);
        setLikeCount(summary.likeCount);
      })
      .catch(() => {
        if (cancelled || requestId.current !== id || cached) return;
        setLiked(false);
        setLikeCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [reelId, user?.id]);

  const onLikePress = useCallback(async () => {
    if (!reelId || pendingRef.current) return;
    if (!user) {
      Alert.alert('Like Reel', 'Sign in to like Reels.');
      router.push('/(tabs)/profile');
      return;
    }

    const previous: ReelLikeSummary = { liked, likeCount };
    const optimistic = optimisticReelLike(previous);
    const id = ++requestId.current;
    const key = cacheKey(reelId, user.id);
    pendingRef.current = true;
    setLikePending(true);
    setLiked(optimistic.liked);
    setLikeCount(optimistic.likeCount);
    cache.set(key, optimistic);

    try {
      const confirmed = optimistic.liked
        ? await likeReel(reelId, surface)
        : await unlikeReel(reelId, surface);
      if (requestId.current !== id) return;
      cache.set(key, confirmed);
      setLiked(confirmed.liked);
      setLikeCount(confirmed.likeCount);
    } catch (error) {
      if (requestId.current !== id) return;
      cache.set(key, previous);
      setLiked(previous.liked);
      setLikeCount(previous.likeCount);
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
  }, [likeCount, liked, reelId, router, surface, user]);

  return {
    reelId,
    liked,
    likeCount,
    likePending,
    onLikePress,
  };
}
