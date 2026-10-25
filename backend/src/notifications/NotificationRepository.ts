import type {
  ActorProfile,
  ClaimedOutboxEvent,
  EnqueueEventInput,
  EnqueueOutcome,
  FailOutboxOutcome,
  FeedQuery,
  MarkReadSelector,
  MaterializeOutcome,
  MaterializeRender,
  NotificationHealthSnapshot,
  NotificationRecord,
  PruneResult,
  PurgeResult,
  SweepResult,
} from './domain/types';
import type { MaterializePush } from './domain/pushPolicy';
import type { PreferenceRow, QuietHours } from './domain/preferencePolicy';
import type { FanOutResult, NotificationCampaign } from './domain/campaign';

export type RetentionArgs = {
  batch: number;
  outboxProcessedDays: number;
  outboxDeadDays: number;
  eventKeyDays: number;
  staleAfterDays: number;
  inboxDays: number;
};

/** Every method maps 1:1 onto a `notification_*` Postgres function (see the Phase 1 migration). */
export interface NotificationRepository {
  enqueueEvent(
    input: EnqueueEventInput,
    staleAfterSeconds: number,
  ): Promise<{ outboxId: string | null; outcome: EnqueueOutcome }>;
  claimOutbox(batch: number, leaseSeconds: number, maxClaims: number): Promise<ClaimedOutboxEvent[]>;
  /** `push` null = push disabled (Phase 1 behaviour; the argument is not even sent). */
  materialize(
    outboxId: string,
    leaseToken: string,
    render: MaterializeRender,
    push?: MaterializePush | null,
  ): Promise<{ outcome: MaterializeOutcome; notificationId: string | null; deliveriesCreated?: number }>;
  failOutbox(
    outboxId: string,
    leaseToken: string,
    error: string,
    retrySeconds: number,
    maxFailures: number,
  ): Promise<FailOutboxOutcome>;
  sweep(maxClaims: number, batch: number): Promise<SweepResult>;
  prune(args: RetentionArgs): Promise<PruneResult>;

  listFeed(userId: string, query: FeedQuery): Promise<NotificationRecord[]>;
  unreadCount(userId: string): Promise<number>;
  markRead(userId: string, selector: MarkReadSelector): Promise<number>;
  markSeen(userId: string, upTo: { sortAt: string; id: string }): Promise<number>;
  recordOpen(userId: string, notificationId: string): Promise<boolean>;
  /** Only CREATED / ACTIVE users are returned; everyone else must never be named. */
  getActiveActorProfiles(ids: string[]): Promise<ActorProfile[]>;

  listPreferences(userId: string): Promise<PreferenceRow[]>;
  replacePreferences(userId: string, rows: PreferenceRow[]): Promise<void>;
  getUserSettings(userId: string): Promise<{
    timezone: string | null;
    quietHours: QuietHours | null;
    promoOptedIn: boolean;
  }>;
  upsertUserSettings(
    userId: string,
    patch: { timezone: string; quietHours: QuietHours | null; promoOptedIn: boolean },
  ): Promise<void>;

  purgeUser(userId: string, batch: number): Promise<PurgeResult>;
  listRecentlyDeletedUserIds(sinceIso: string, limit: number): Promise<string[]>;
  healthSnapshot(): Promise<NotificationHealthSnapshot>;

  materializeMany(
    items: {
      outboxId: string;
      leaseToken: string;
      render: MaterializeRender;
      push?: MaterializePush | null;
    }[],
  ): Promise<{ outcome: MaterializeOutcome; notificationId: string | null; deliveriesCreated?: number }[]>;

  insertCampaign(
    campaign: Omit<NotificationCampaign, 'id' | 'status' | 'cursorUserId' | 'fannedOut'> & { id?: string },
  ): Promise<NotificationCampaign>;
  getCampaign(id: string): Promise<NotificationCampaign | null>;
  listActiveCampaigns(): Promise<NotificationCampaign[]>;
  fanOutCampaign(id: string, batch: number): Promise<FanOutResult>;
}
