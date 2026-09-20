import { useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { TopBar } from '@/components/chrome/TopBar';
import { PersonalCollectionList } from '@/components/profile/PersonalCollectionList';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { listCreatorCollections } from '@/src/services/collectionApi';
import { ensureMe } from '@/src/services/userApi';
import type { CollectionViewModel } from '@/src/types/collection';
import { collectionTilePressPath } from '@/src/ui/collectionLayout';
import { PERSONAL_PROFILE_COPY } from '@/src/ui/personalProfile';

export default function PersonalCollectionsScreen() {
  const router = useRouter();
  const { tokens } = useThemeMode();
  const { user } = useAuth();
  const [items, setItems] = useState<CollectionViewModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [creatorId, setCreatorId] = useState<string | null>(null);

  const load = useCallback(async (id: string, nextCursor?: string | null, append = false) => {
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setError(null);
    }
    try {
      const page = await listCreatorCollections(id, { limit: 20, cursor: nextCursor ?? null });
      setItems((prev) => (append ? [...prev, ...page.collections] : page.collections));
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : PERSONAL_PROFILE_COPY.emptyCollections);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void ensureMe().then((me) => {
      if (cancelled) return;
      setCreatorId(me.userId);
      void load(me.userId);
    });
    return () => {
      cancelled = true;
    };
  }, [load, user]);

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <TopBar mode="page" title={PERSONAL_PROFILE_COPY.collections} showBack showBag={false} />
      <PersonalCollectionList
        items={items}
        loading={loading}
        error={error}
        empty={PERSONAL_PROFILE_COPY.emptyCollections}
        variant="personal"
        loadingMore={loadingMore}
        onPress={(collection) =>
          router.push(collectionTilePressPath(collection.collectionId) as Href)
        }
        onEndReached={() => {
          if (!creatorId || !cursor || loadingMore) return;
          void load(creatorId, cursor, true);
        }}
      />
    </View>
  );
}
