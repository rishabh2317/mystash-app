import React, { useCallback, useEffect, useState } from 'react';

import { CollectionTile } from '@/components/collection/CollectionTile';
import { useAuth } from '@/contexts/AuthContext';
import { useCollectionSaveHandler } from '@/src/services/collectionSaveOrchestration';
import { isCollectionSaved } from '@/src/services/engagementApi';
import type { CollectionViewModel } from '@/src/types/collection';

type Props = {
  collection: CollectionViewModel;
  onPress: (collection: CollectionViewModel) => void;
};

/**
 * Public-profile collection cell: product-count overlay + real Save / Unsave
 * (same auth-gated engagement path as reel / collection save).
 */
export function PublicCollectionTile({ collection, onPress }: Props) {
  const { user } = useAuth();
  const [isSaved, setIsSaved] = useState(false);
  const [savePending, setSavePending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsSaved(false);
    if (!user) return undefined;
    void isCollectionSaved(collection.collectionId)
      .then((saved) => {
        if (!cancelled) setIsSaved(saved);
      })
      .catch(() => {
        if (!cancelled) setIsSaved(false);
      });
    return () => {
      cancelled = true;
    };
  }, [collection.collectionId, user]);

  const saveHandler = useCollectionSaveHandler({
    collectionId: collection.collectionId,
    creatorId: collection.creator.id || null,
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

  const onSavePress = useCallback(async () => {
    setSavePending(true);
    try {
      await saveHandler();
    } finally {
      setSavePending(false);
    }
  }, [saveHandler]);

  return (
    <CollectionTile
      collection={collection}
      variant="public"
      onPress={onPress}
      isSaved={isSaved}
      savePending={savePending}
      onSavePress={() => void onSavePress()}
    />
  );
}
