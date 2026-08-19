export type EngagementEventName =
  | 'CollectionImpressed'
  | 'CollectionViewed'
  | 'CollectionOpened'
  | 'CollectionSaved'
  | 'CollectionUnsaved'
  | 'CollectionShared'
  | 'CollectionCompleted'
  | 'CollectionViewInvalidated'
  | 'CreatorFollowed'
  | 'CreatorUnfollowed'
  | 'CreatorProfileViewed'
  | 'ProductClicked'
  | 'MerchantClicked'
  | 'PurchaseAttributed'
  | 'EngagementAggregated'
  | 'CounterUpdated'
  | 'EngagementActorErased';

export type EngagementEventPayload = {
  occurredAt: string;
  eventId?: string;
  actorUserId?: string | null;
  anonymousId?: string | null;
  objectType?: string;
  objectId?: string;
  collectionId?: string | null;
  collectionProductTagId?: string | null;
  catalogProductId?: string | null;
  creatorId?: string | null;
  interactionType?: string;
  counterName?: string;
  counterValue?: number;
  from?: string;
  to?: string;
};

export function buildEngagementEventPayload(
  partial: Omit<EngagementEventPayload, 'occurredAt'> & { occurredAt?: string },
): EngagementEventPayload {
  return {
    ...partial,
    occurredAt: partial.occurredAt ?? new Date().toISOString(),
  };
}
