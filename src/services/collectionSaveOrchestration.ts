import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import { buildSaveCollectionLoginHref } from '@/src/navigation/authIntent';
import { saveCollection, unsaveCollection } from '@/src/services/engagementApi';

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

  return useCallback(async () => {
    if (!user) {
      const loginHref = buildSaveCollectionLoginHref({
        collectionId: opts.collectionId,
      });
      if (!loginHref) {
        Alert.alert('Unavailable', 'Could not start save.');
        return;
      }
      router.push(loginHref);
      return;
    }

    const previous = opts.isSaved;
    const next = !previous;
    opts.onOptimisticSave(next);
    try {
      if (next) {
        await saveCollection(opts.collectionId, {
          creatorId: opts.creatorId ?? undefined,
        });
      } else {
        await unsaveCollection(opts.collectionId);
      }
    } catch (e) {
      opts.onRollback(previous);
      Alert.alert('Save', e instanceof Error ? e.message : 'Could not update save.');
    }
  }, [opts, router, user]);
}
