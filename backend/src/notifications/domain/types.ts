export type NotificationCategory = 'social' | 'task' | 'account' | 'security' | 'promo';
export type NotificationChannel = 'inbox' | 'push';

export type NotificationEventType =
  | 'collection.publish_succeeded'
  | 'collection.publish_failed'
  | 'ingest.ready_for_review'
  | 'ingest.failed'
  | 'creator_library.sync_failed'
  | 'connected_account.needs_reauth'
  | 'creator.status_changed'
  | 'creator.followed'
  | 'collection.saved'
  | 'reel.liked'
  | 'promo.broadcast';

export type EnqueueOutcome = 'enqueued' | 'duplicate' | 'stale' | 'self';

export type OutboxResult =
  | 'created'
  | 'aggregated'
  | 'suppressed_preference'
  | 'suppressed_recipient'
  | 'suppressed_self'
  | 'suppressed_actor_unavailable';

export type MaterializeOutcome = OutboxResult | 'lease_lost';

export type FailOutboxOutcome = 'retrying' | 'dead' | 'lease_lost';

export type EnqueueEventInput = {
  eventType: NotificationEventType;
  idempotencyKey: string;
  recipientUserId: string;
  actorUserId: string | null;
  /** Timestamp of the source record (fact / transition), never "now". */
  occurredAt: string;
  payload: Record<string, unknown>;
  schemaVersion?: number;
};

export type ClaimedOutboxEvent = {
  outboxId: string;
  leaseToken: string;
  claimCount: number;
  eventType: string;
  schemaVersion: number;
  recipientUserId: string;
  actorUserId: string | null;
  occurredAt: string;
  payload: Record<string, unknown>;
};

/** Deterministic render handed to `notification_materialize`. */
export type MaterializeRender = {
  type: NotificationEventType;
  category: NotificationCategory;
  title: string;
  body: string;
  data: Record<string, unknown>;
  deep_link: string;
  group_key: string | null;
  group_window_seconds: number | null;
  requires_actor: boolean;
  expires_at: string | null;
};

export type NotificationRecord = {
  id: string;
  userId: string;
  type: string;
  category: NotificationCategory;
  title: string;
  body: string;
  data: Record<string, unknown>;
  deepLink: string | null;
  groupKey: string | null;
  actorCount: number;
  sampleActorIds: string[];
  sortAt: string;
  seenAt: string | null;
  readAt: string | null;
  createdAt: string;
};

export type FeedCursor = { sortAt: string; id: string };

export type FeedQuery = {
  before: FeedCursor | null;
  limit: number;
  category: NotificationCategory | null;
};

export type ActorProfile = {
  id: string;
  username: string;
  displayName: string | null;
  profilePhotoUrl: string | null;
};

export type NotificationActorView = {
  id: string;
  username: string;
  displayName: string | null;
  profilePhotoUrl: string | null;
};

export type NotificationView = {
  id: string;
  type: string;
  category: NotificationCategory;
  title: string;
  body: string;
  deepLink: string;
  actors: NotificationActorView[];
  actorCount: number;
  read: boolean;
  seen: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MarkReadSelector = { ids: string[] } | { before: FeedCursor } | { all: true };

export type PurgeResult = {
  notificationsDeleted: number;
  outboxDeleted: number;
  actorRowsRemoved: number;
  actorOutboxCleared: number;
  done: boolean;
};

export type PruneResult = {
  outboxProcessed: number;
  outboxDead: number;
  eventKeys: number;
  notifications: number;
  /** Absent before the Phase 4 migration. */
  deliveries?: number;
  registrations?: number;
};

export type SweepResult = {
  outboxDead: number;
  /** Absent before the Phase 4 migration. */
  deliveriesExpired?: number;
  deliveriesFailedDispatch?: number;
  sendingAbandoned?: number;
};

export type NotificationHealthSnapshot = {
  outboxOldestDueCreatedAt: string | null;
  outboxDueCountCapped: number;
  outboxDeadCountCapped: number;
  /** Absent before the Phase 4 migration. */
  pushOldestDueAvailableAt?: string | null;
  pushStuckSendingCountCapped?: number;
  pushReceiptsOverdueCountCapped?: number;
};
