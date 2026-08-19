import type { CollectionStatus } from './types';

export type CollectionEventName =
  | 'CollectionProcessingStarted'
  | 'CollectionPublished'
  | 'CollectionRejected'
  | 'CollectionUpdated'
  | 'CollectionUnpublished'
  | 'CollectionArchived'
  | 'CollectionDeleted';

export type CollectionEventPayload = {
  collectionId: string;
  creatorId: string;
  status: CollectionStatus;
  contentRevision: number;
  occurredAt: string;
  ingestId?: string | null;
  slug?: string | null;
};

export function buildCollectionEventPayload(
  partial: Omit<CollectionEventPayload, 'occurredAt'> & { occurredAt?: string },
): CollectionEventPayload {
  return {
    ...partial,
    occurredAt: partial.occurredAt ?? new Date().toISOString(),
  };
}
