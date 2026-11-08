import { useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import { buildFollowCreatorLoginHref } from '@/src/navigation/authIntent';
import { maybePromptForPush } from '@/src/notifications/permissionPrompt';
import { followCreator, isFollowingCreator, unfollowCreator } from '@/src/services/engagementApi';

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
  const optionsRef = useRef(opts);
  optionsRef.current = opts;
  const pendingPromiseRef = useRef<Promise<void> | null>(null);
  const operationRef = useRef({ creatorId: opts.creatorId, ownerId: user?.id, actual: opts.isFollowing, desired: opts.isFollowing, running: false });
  if (operationRef.current.creatorId !== opts.creatorId || operationRef.current.ownerId !== user?.id) {
    operationRef.current = { creatorId: opts.creatorId, ownerId: user?.id, actual: opts.isFollowing, desired: opts.isFollowing, running: false };
  } else if (!operationRef.current.running) {
    operationRef.current.actual = opts.isFollowing;
    operationRef.current.desired = opts.isFollowing;
  }

  return useCallback(async () => {
    if (optionsRef.current.isSelf) return;

    if (!user) {
      const loginHref = buildFollowCreatorLoginHref({
        creatorId: optionsRef.current.creatorId,
        username: optionsRef.current.username,
      });
      if (!loginHref) {
        Alert.alert('Unavailable', 'Could not start follow.');
        return;
      }
      router.push(loginHref);
      return;
    }

    const operation = operationRef.current;
    const entityOptions = optionsRef.current;
    const next = !operation.desired;
    operation.desired = next;
    entityOptions.onOptimisticFollow(next);
    if (operation.running) return pendingPromiseRef.current;
    operation.running = true;
    let settle!: () => void;
    pendingPromiseRef.current = new Promise<void>((resolve) => { settle = resolve; });
    try {
      while (operation.actual !== operation.desired) {
        const target = operation.desired;
        if (target) {
          await followCreator(operation.creatorId);
          void maybePromptForPush('first_follow');
        } else {
          await unfollowCreator(operation.creatorId);
        }
        operation.actual = target;
        if (operationRef.current !== operation) return;
      }
      const confirmed = await isFollowingCreator(operation.creatorId).catch(() => operation.actual);
      if (operationRef.current !== operation) return;
      operation.actual = confirmed;
      if (operation.desired !== confirmed) {
        optionsRef.current.onOptimisticFollow(confirmed);
        operation.desired = confirmed;
      }
    } catch (e) {
      const actual = await isFollowingCreator(operation.creatorId).catch(() => operation.actual);
      if (operationRef.current !== operation) return;
      operation.actual = actual;
      if (operation.desired !== actual) optionsRef.current.onOptimisticFollow(actual);
      operation.desired = actual;
      Alert.alert('Follow', e instanceof Error ? e.message : 'Could not update follow.');
    } finally {
      operation.running = false;
      settle();
      if (operationRef.current === operation) pendingPromiseRef.current = null;
    }
  }, [router, user]);
}
