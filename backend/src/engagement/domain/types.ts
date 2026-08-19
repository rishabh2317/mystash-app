/** Engagement domain types — V1 subset of ENGAGEMENT_DOMAIN_SPEC.md */

export type PrivacyClass = 'public' | 'private' | 'anonymous';

export type EngagementObjectType =
  | 'collection'
  | 'creator'
  | 'catalog_product'
  | 'collection_product_tag'
  | 'session'
  | 'app'
  | 'user';

export type InteractionType =
  | 'impression'
  | 'view'
  | 'open'
  | 'save'
  | 'unsave'
  | 'share'
  | 'hide'
  | 'report'
  | 'completion'
  | 'rewatch'
  | 'follow'
  | 'unfollow'
  | 'profile_view'
  | 'product_impression'
  | 'product_expand'
  | 'product_click'
  | 'product_save'
  | 'product_share'
  | 'merchant_click'
  | 'buy_intent'
  | 'purchase_attributed'
  | 'view_invalidated';

export type EdgeType = 'FOLLOW' | 'SAVE' | 'HIDE' | 'WISHLIST';

export type EdgeState = 'ACTIVE' | 'REMOVED';

export type CounterName =
  | 'views'
  | 'unique_views'
  | 'saves'
  | 'shares'
  | 'product_clicks'
  | 'merchant_clicks'
  | 'purchases'
  | 'followers'
  | 'following';

export type InteractionFact = {
  id: string;
  eventId: string;
  interactionType: InteractionType;
  objectType: EngagementObjectType;
  objectId: string;
  actorUserId: string | null;
  anonymousId: string | null;
  privacyClass: PrivacyClass;
  collectionId: string | null;
  collectionProductTagId: string | null;
  catalogProductId: string | null;
  creatorId: string | null;
  sessionId: string | null;
  surface: string | null;
  compensatingForEventId: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
};

export type RelationshipEdge = {
  id: string;
  userId: string;
  edgeType: EdgeType;
  objectType: 'creator' | 'collection' | 'catalog_product';
  objectId: string;
  state: EdgeState;
  sourceEventId: string | null;
  privacyClass: PrivacyClass;
  createdAt: string;
  updatedAt: string;
};

export type CounterProjection = {
  objectType: EngagementObjectType;
  objectId: string;
  counterName: CounterName;
  value: number;
  updatedAt: string;
};

export type RecordFactInput = {
  eventId: string;
  interactionType: InteractionType;
  objectType: EngagementObjectType;
  objectId: string;
  actorUserId?: string | null;
  anonymousId?: string | null;
  privacyClass?: PrivacyClass;
  collectionId?: string | null;
  collectionProductTagId?: string | null;
  catalogProductId?: string | null;
  creatorId?: string | null;
  sessionId?: string | null;
  surface?: string | null;
  compensatingForEventId?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
};

/** V1: no Like. */
export const V1_FORBIDDEN_EDGE_TYPES = [] as const;
