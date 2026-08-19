import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import { buildFollowCreatorLoginHref } from '@/src/navigation/authIntent';
import { followCreator, unfollowCreator } from '@/src/services/engagementApi';

/**
 * Auth-gated Follow / Unfollow orchestration.
 * FollowControl must never call auth or Engagement APIs itself.
 */
export function useCreatorFollowHandler(opts: {
  creatorId: string;
  username: string;
  isSelf: boolean;
  isFollowing: boolean;
  onOptimisticFollow: (next: boolean) => void;
  onRollback: (previous: boolean) => void;
}) {
  const { user } = useAuth();
  const router = useRouter();

  return useCallback(async () => {
    if (opts.isSelf) return;

    if (!user) {
      const loginHref = buildFollowCreatorLoginHref({
        creatorId: opts.creatorId,
        username: opts.username,
      });
      if (!loginHref) {
        Alert.alert('Unavailable', 'Could not start follow.');
        return;
      }
      router.push(loginHref);
      return;
    }

    const previous = opts.isFollowing;
    const next = !previous;
    opts.onOptimisticFollow(next);
    try {
      if (next) {
        await followCreator(opts.creatorId);
      } else {
        await unfollowCreator(opts.creatorId);
      }
    } catch (e) {
      opts.onRollback(previous);
      Alert.alert('Follow', e instanceof Error ? e.message : 'Could not update follow.');
    }
  }, [opts, router, user]);
}
