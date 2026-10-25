import { useCallback, useEffect, useRef, useState } from 'react';

import { loadDiscoverCreatorSuggestions } from '@/src/services/discoverCreatorsLoad';
import {
  DISCOVER_CREATORS_PROFILE_LIMIT,
  discoverCreatorsProfileSlice,
  type DiscoverCreatorSuggestion,
} from '@/src/ui/discoverCreators';

type Options = {
  excludeUserId?: string | null;
  excludeUsername?: string | null;
};

export function discoverCreatorsIdentityKey(
  excludeUserId?: string | null,
  excludeUsername?: string | null,
): string {
  return `${excludeUserId ?? ''}|${excludeUsername ?? ''}`;
}

/**
 * Profile Discover Creators load. Tied to the viewed identity, not Collection/Saved
 * (or Collections/Products) tab selection. Survives tab-keyed list remounts.
 */
export function useDiscoverCreators({ excludeUserId, excludeUsername }: Options) {
  const identity = discoverCreatorsIdentityKey(excludeUserId, excludeUsername);
  const [items, setItems] = useState<DiscoverCreatorSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);
  const loadedKeyRef = useRef<string | null>(null);

  const load = useCallback(
    async (force: boolean) => {
      if (!force && loadedKeyRef.current === identity) return;
      const requestId = ++requestIdRef.current;
      setLoading(true);
      try {
        const next = await loadDiscoverCreatorSuggestions({
          excludeUserId,
          excludeUsername,
          limit: DISCOVER_CREATORS_PROFILE_LIMIT,
        });
        if (requestId !== requestIdRef.current) return;
        setItems(discoverCreatorsProfileSlice(next));
        loadedKeyRef.current = identity;
      } catch {
        if (requestId !== requestIdRef.current) return;
        setItems([]);
        loadedKeyRef.current = identity;
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [excludeUserId, excludeUsername, identity],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const reload = useCallback(() => {
    void load(true);
  }, [load]);

  return { items, loading, reload };
}
