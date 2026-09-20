import { useRouter, type Href } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import { TopBar } from '@/components/chrome/TopBar';
import { PersonalCollectionList } from '@/components/profile/PersonalCollectionList';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { loadSavedCollections } from '@/src/services/personalProfileContent';
import type { CollectionViewModel } from '@/src/types/collection';
import { collectionTilePressPath } from '@/src/ui/collectionLayout';
import { PERSONAL_PROFILE_COPY } from '@/src/ui/personalProfile';

export default function PersonalSavedScreen() {
  const router = useRouter();
  const { tokens } = useThemeMode();
  const { user } = useAuth();
  const [items, setItems] = useState<CollectionViewModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    void loadSavedCollections()
      .then((rows) => {
        if (!cancelled) setItems(rows.items);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : PERSONAL_PROFILE_COPY.emptySaved);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <TopBar mode="page" title={PERSONAL_PROFILE_COPY.saved} showBack showBag={false} />
      <PersonalCollectionList
        items={items}
        loading={loading}
        error={error}
        empty={PERSONAL_PROFILE_COPY.emptySaved}
        variant="personal"
        onPress={(collection) =>
          router.push(collectionTilePressPath(collection.collectionId) as Href)
        }
      />
    </View>
  );
}
