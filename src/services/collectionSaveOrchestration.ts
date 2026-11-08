import { useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import { buildSaveCollectionLoginHref } from '@/src/navigation/authIntent';
import { isCollectionSaved, saveCollection, unsaveCollection } from '@/src/services/engagementApi';

/**
 * Auth-gated Save / Unsave orchestration.
 * SaveControl must never call auth or Engagement APIs itself.
 */
export function useCollectionSaveHandler(opts: {
  collectionId: string;
  creatorId?: string | null;
  isSaved: boolean;
  onOptimisticSave: (next: boolean) => void;
  onRollback: (previous: boolean) => void;
}) {
  const { user } = useAuth();
  const router = useRouter();
  const optionsRef = useRef(opts);
  optionsRef.current = opts;
  const pendingPromiseRef = useRef<Promise<void> | null>(null);
  const operationRef = useRef({ collectionId: opts.collectionId, ownerId: user?.id, actual: opts.isSaved, desired: opts.isSaved, running: false });
  if (operationRef.current.collectionId !== opts.collectionId || operationRef.current.ownerId !== user?.id) {
    operationRef.current = { collectionId: opts.collectionId, ownerId: user?.id, actual: opts.isSaved, desired: opts.isSaved, running: false };
  } else if (!operationRef.current.running) {
    operationRef.current.actual = opts.isSaved;
    operationRef.current.desired = opts.isSaved;
  }

  return useCallback(async () => {
    if (!user) {
      const loginHref = buildSaveCollectionLoginHref({
        collectionId: optionsRef.current.collectionId,
      });
      if (!loginHref) {
        Alert.alert('Unavailable', 'Could not start save.');
        return;
      }
      router.push(loginHref);
      return;
    }

    const operation = operationRef.current;
    const entityOptions = optionsRef.current;
    const next = !operation.desired;
    operation.desired = next;
    entityOptions.onOptimisticSave(next);
    if (operation.running) return pendingPromiseRef.current;
    operation.running = true;
    let settle!: () => void;
    pendingPromiseRef.current = new Promise<void>((resolve) => { settle = resolve; });
    try {
      while (operation.actual !== operation.desired) {
        const target = operation.desired;
        if (target) {
          await saveCollection(operation.collectionId, { creatorId: entityOptions.creatorId ?? undefined });
        } else {
          await unsaveCollection(operation.collectionId);
        }
        operation.actual = target;
        if (operationRef.current !== operation) return;
      }
      const confirmed = await isCollectionSaved(operation.collectionId).catch(() => operation.actual);
      if (operationRef.current !== operation) return;
      operation.actual = confirmed;
      if (operation.desired !== confirmed) {
        optionsRef.current.onOptimisticSave(confirmed);
        operation.desired = confirmed;
      }
    } catch (e) {
      const actual = await isCollectionSaved(operation.collectionId).catch(() => operation.actual);
      if (operationRef.current !== operation) return;
      operation.actual = actual;
      if (operation.desired !== actual) optionsRef.current.onOptimisticSave(actual);
      operation.desired = actual;
      Alert.alert('Save', e instanceof Error ? e.message : 'Could not update save.');
    } finally {
      operation.running = false;
      settle();
      if (operationRef.current === operation) pendingPromiseRef.current = null;
    }
  }, [router, user]);
}
