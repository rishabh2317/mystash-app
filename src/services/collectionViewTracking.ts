import { useEffect, useRef } from 'react';

import { recordCollectionView } from '@/src/services/engagementApi';

/** Session dedupe: avoid double-fire from Strict Mode / fast remount of same surface. */
const recentViews = new Map<string, number>();
const DEDUPE_MS = 8_000;

/**
 * Fire-and-forget Collection view with the same session dedupe as
 * `useRecordCollectionView` (Home Reel + Collection/Focused Reel).
 * Never falls back to video.id — caller must pass `collection_id`.
 */
export function recordCollectionViewOnce(input: {
  collectionId: string | null | undefined;
  creatorId?: string | null;
  surface: string;
}): void {
  const id = input.collectionId?.trim();
  if (!id) return;
  const key = `${input.surface}:${id}`;
  const last = recentViews.get(key) ?? 0;
  if (Date.now() - last < DEDUPE_MS) return;
  recentViews.set(key, Date.now());
  void recordCollectionView({
    collectionId: id,
    creatorId: input.creatorId,
    surface: input.surface,
  }).catch(() => {
    // Analytics must not block the feed.
  });
}

/**
 * Emit one Collection `view` per meaningful open of a Collection surface.
 * Failures are swallowed — analytics must not block the page.
 */
export function useRecordCollectionView(input: {
  collectionId: string | null | undefined;
  creatorId?: string | null;
  surface: string;
  enabled?: boolean;
}): void {
  const recordedFor = useRef<string | null>(null);

  useEffect(() => {
    const id = input.collectionId?.trim();
    if (!id || input.enabled === false) return;
    const key = `${input.surface}:${id}`;
    if (recordedFor.current === key) return;
    recordedFor.current = key;
    recordCollectionViewOnce({
      collectionId: id,
      creatorId: input.creatorId,
      surface: input.surface,
    });
  }, [input.collectionId, input.creatorId, input.surface, input.enabled]);
}
