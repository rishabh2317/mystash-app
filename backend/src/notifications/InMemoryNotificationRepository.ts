import { randomUUID } from 'node:crypto';
import type { NotificationRepository, RetentionArgs } from './NotificationRepository';
import type { MaterializePush } from './domain/pushPolicy';
import type { PreferenceRow, QuietHours } from './domain/preferencePolicy';
import type { CampaignAudience, FanOutResult, NotificationCampaign } from './domain/campaign';
import { campaignIdempotencyKey } from './domain/campaign';
import { STALE_AFTER_SECONDS } from './domain/policy';
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
  NotificationCategory,
  NotificationChannel,
  NotificationHealthSnapshot,
  NotificationRecord,
  OutboxResult,
  PruneResult,
  PurgeResult,
} from './domain/types';

type AccountStatus = 'CREATED' | 'ACTIVE' | 'SUSPENDED' | 'DELETED' | 'ARCHIVED';

type UserRow = {
  id: string;
  accountStatus: AccountStatus;
  deletedAt: string | null;
  username: string;
  displayName: string | null;
  profilePhotoUrl: string | null;
};

type OutboxRow = {
  id: number;
  eventType: string;
  idempotencyKey: string;
  schemaVersion: number;
  recipientUserId: string;
  actorUserId: string | null;
  occurredAt: number;
  payload: Record<string, unknown>;
  status: 'pending' | 'claimed' | 'processed' | 'dead';
  availableAt: number;
  leaseToken: string | null;
  claimCount: number;
  failureCount: number;
  lastError: string | null;
  result: OutboxResult | null;
  notificationId: string | null;
  createdAt: number;
  processedAt: number | null;
};

type NotificationRow = {
  id: string;
  userId: string;
  type: string;
  category: NotificationCategory;
  schemaVersion: number;
  title: string;
  body: string;
  inboxVisible: boolean;
  data: Record<string, unknown>;
  deepLink: string | null;
  groupKey: string | null;
  groupBucket: number | null;
  actorCount: number;
  eventCount: number;
  sampleActorIds: string[];
  lastActorUserId: string | null;
  sortAt: number;
  seenAt: number | null;
  readAt: number | null;
  archivedAt: number | null;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
};

const BUCKET_ORIGIN = Date.UTC(2000, 0, 1);
const DAY_MS = 86_400_000;

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

/** Behavioural twin of the Phase 1 SQL functions; keep in lockstep with the migration. */
export class InMemoryNotificationRepository implements NotificationRepository {
  readonly users = new Map<string, UserRow>();
  readonly eventKeys = new Map<string, { occurredAt: number; outboxId: number | null; createdAt: number }>();
  readonly outbox = new Map<number, OutboxRow>();
  readonly notifications = new Map<string, NotificationRow>();
  readonly groupActors = new Map<string, Map<string, { firstOutboxId: number; createdAt: number }>>();
  readonly preferences = new Map<string, boolean>();
  readonly promoOptIn = new Set<string>();
  readonly userSettings = new Map<string, { timezone: string; quietHours: { start: string; end: string } | null }>();
  readonly campaigns = new Map<string, NotificationCampaign>();
  readonly materializePushArgs: (MaterializePush | null)[] = [];
  private nextOutboxId = 1;
  private tick = 0;

  constructor(private readonly clock: () => number = () => Date.now()) {}

  /** Strictly increasing so equal-clock writes keep a deterministic order. */
  private now(): number {
    const t = this.clock();
    this.tick = Math.max(this.tick + 1, t);
    return this.tick;
  }

  addUser(id: string, patch: Partial<Omit<UserRow, 'id'>> = {}): void {
    this.users.set(id, {
      id,
      accountStatus: patch.accountStatus ?? 'ACTIVE',
      deletedAt: patch.deletedAt ?? null,
      username: patch.username ?? `user_${id.slice(0, 6)}`,
      displayName: patch.displayName ?? null,
      profilePhotoUrl: patch.profilePhotoUrl ?? null,
    });
  }

  setPreference(userId: string, category: NotificationCategory, channel: NotificationChannel, enabled: boolean): void {
    if (category !== 'social' && category !== 'promo' && channel === 'inbox') {
      throw new Error('notification_preferences_pair_chk');
    }
    if (category === 'security') throw new Error('notification_preferences category check');
    this.preferences.set(`${userId}:${category}:${channel}`, enabled);
  }

  private channelEnabled(userId: string, category: NotificationCategory, channel: NotificationChannel): boolean {
    if (category === 'security') return true;
    if (channel === 'inbox' && (category === 'task' || category === 'account')) return true;
    const stored = this.preferences.get(`${userId}:${category}:${channel}`);
    if (channel === 'push' && category === 'promo') return (stored ?? false) && this.promoOptIn.has(userId);
    return stored ?? true;
  }

  private isActive(userId: string | null): boolean {
    if (!userId) return false;
    const user = this.users.get(userId);
    return !user || user.accountStatus === 'CREATED' || user.accountStatus === 'ACTIVE';
  }

  async enqueueEvent(
    input: EnqueueEventInput,
    staleAfterSeconds: number,
  ): Promise<{ outboxId: string | null; outcome: EnqueueOutcome }> {
    const now = this.now();
    const occurredAt = Date.parse(input.occurredAt);
    if (occurredAt > now + 5 * 60_000) throw new Error('notification_enqueue_event: occurred_at is in the future');
    if (occurredAt < now - staleAfterSeconds * 1000) return { outboxId: null, outcome: 'stale' };
    if (input.actorUserId && input.actorUserId === input.recipientUserId) return { outboxId: null, outcome: 'self' };
    const key = `${input.eventType}|${input.idempotencyKey}`;
    if (this.eventKeys.has(key)) return { outboxId: null, outcome: 'duplicate' };
    const id = this.nextOutboxId++;
    this.eventKeys.set(key, { occurredAt, outboxId: id, createdAt: now });
    this.outbox.set(id, {
      id,
      eventType: input.eventType,
      idempotencyKey: input.idempotencyKey,
      schemaVersion: input.schemaVersion ?? 1,
      recipientUserId: input.recipientUserId,
      actorUserId: input.actorUserId,
      occurredAt,
      payload: input.payload,
      status: 'pending',
      availableAt: now,
      leaseToken: null,
      claimCount: 0,
      failureCount: 0,
      lastError: null,
      result: null,
      notificationId: null,
      createdAt: now,
      processedAt: null,
    });
    return { outboxId: String(id), outcome: 'enqueued' };
  }

  async claimOutbox(batch: number, leaseSeconds: number, maxClaims: number): Promise<ClaimedOutboxEvent[]> {
    const now = this.now();
    const eligible = [...this.outbox.values()]
      .filter(
        (o) =>
          (o.status === 'pending' || o.status === 'claimed') && o.availableAt <= now && o.claimCount < maxClaims,
      )
      .sort((a, b) => a.availableAt - b.availableAt || a.id - b.id)
      .slice(0, Math.min(Math.max(batch, 1), 500));
    return eligible.map((o) => {
      o.status = 'claimed';
      o.leaseToken = randomUUID();
      o.availableAt = now + leaseSeconds * 1000;
      o.claimCount += 1;
      return {
        outboxId: String(o.id),
        leaseToken: o.leaseToken,
        claimCount: o.claimCount,
        eventType: o.eventType,
        schemaVersion: o.schemaVersion,
        recipientUserId: o.recipientUserId,
        actorUserId: o.actorUserId,
        occurredAt: new Date(o.occurredAt).toISOString(),
        payload: o.payload,
      };
    });
  }

  async materialize(
    outboxId: string,
    leaseToken: string,
    render: MaterializeRender,
    push?: MaterializePush | null,
  ): Promise<{ outcome: MaterializeOutcome; notificationId: string | null; deliveriesCreated?: number }> {
    this.materializePushArgs.push(push ?? null);
    const o = this.outbox.get(Number(outboxId));
    if (!o || o.status !== 'claimed' || o.leaseToken !== leaseToken) {
      return { outcome: 'lease_lost', notificationId: null };
    }
    const now = this.now();
    let result: OutboxResult | null = null;
    let notificationId: string | null = null;

    if (!this.isActive(o.recipientUserId)) result = 'suppressed_recipient';
    else if (render.requires_actor && !this.isActive(o.actorUserId)) result = 'suppressed_actor_unavailable';

    const inboxOn = result ? false : this.channelEnabled(o.recipientUserId, render.category, 'inbox');
    if (!result && !inboxOn) result = 'suppressed_preference';

    if (!result && !render.group_key) {
      const row = this.insertNotification(o, render, inboxOn, now, null, null);
      row.actorCount = o.actorUserId ? 1 : 0;
      row.eventCount = 1;
      row.sampleActorIds = o.actorUserId ? [o.actorUserId] : [];
      row.lastActorUserId = o.actorUserId;
      if (o.actorUserId) this.actorsOf(row.id).set(o.actorUserId, { firstOutboxId: o.id, createdAt: now });
      notificationId = row.id;
      result = 'created';
    } else if (!result && render.group_key) {
      const windowMs = (render.group_window_seconds ?? 3600) * 1000;
      const bucket = BUCKET_ORIGIN + Math.floor((o.occurredAt - BUCKET_ORIGIN) / windowMs) * windowMs;
      let row = [...this.notifications.values()].find(
        (n) => n.userId === o.recipientUserId && n.groupKey === render.group_key && n.groupBucket === bucket,
      );
      const first = !row;
      if (!row) row = this.insertNotification(o, render, inboxOn, now, render.group_key, bucket);
      let newActor = false;
      if (o.actorUserId) {
        const actors = this.actorsOf(row.id);
        if (!actors.has(o.actorUserId)) {
          actors.set(o.actorUserId, { firstOutboxId: o.id, createdAt: now });
          newActor = true;
        }
      }
      row.eventCount += 1;
      if (newActor) {
        row.actorCount += 1;
        if (row.sampleActorIds.length < 3) row.sampleActorIds = [...row.sampleActorIds, o.actorUserId as string];
      }
      row.lastActorUserId = o.actorUserId ?? row.lastActorUserId;
      row.inboxVisible = row.inboxVisible || inboxOn;
      if (newActor && !first) {
        row.readAt = null;
        row.seenAt = null;
        row.sortAt = now;
      }
      row.updatedAt = now;
      notificationId = row.id;
      result = first ? 'created' : 'aggregated';
    }

    o.status = 'processed';
    o.result = result;
    o.notificationId = notificationId;
    o.processedAt = now;
    o.leaseToken = null;
    return { outcome: result as OutboxResult, notificationId };
  }

  private insertNotification(
    o: OutboxRow,
    render: MaterializeRender,
    inboxVisible: boolean,
    now: number,
    groupKey: string | null,
    groupBucket: number | null,
  ): NotificationRow {
    const row: NotificationRow = {
      id: randomUUID(),
      userId: o.recipientUserId,
      type: render.type,
      category: render.category,
      schemaVersion: o.schemaVersion,
      title: render.title,
      body: render.body,
      inboxVisible,
      data: render.data,
      deepLink: render.deep_link || null,
      groupKey,
      groupBucket,
      actorCount: 0,
      eventCount: 0,
      sampleActorIds: [],
      lastActorUserId: null,
      sortAt: now,
      seenAt: null,
      readAt: null,
      archivedAt: null,
      expiresAt: render.expires_at ? Date.parse(render.expires_at) : null,
      createdAt: now,
      updatedAt: now,
    };
    this.notifications.set(row.id, row);
    return row;
  }

  private actorsOf(notificationId: string): Map<string, { firstOutboxId: number; createdAt: number }> {
    let actors = this.groupActors.get(notificationId);
    if (!actors) {
      actors = new Map();
      this.groupActors.set(notificationId, actors);
    }
    return actors;
  }

  private deleteNotification(id: string): void {
    this.notifications.delete(id);
    this.groupActors.delete(id);
  }

  /** Mirrors the AFTER DELETE trigger on notification_group_actors. */
  private removeActor(notificationId: string, actorId: string): void {
    const actors = this.groupActors.get(notificationId);
    if (!actors?.delete(actorId)) return;
    const row = this.notifications.get(notificationId);
    if (!row) return;
    const remaining = [...actors.entries()].sort(
      (a, b) => a[1].createdAt - b[1].createdAt || a[0].localeCompare(b[0]),
    );
    if (remaining.length === 0) {
      this.deleteNotification(notificationId);
      return;
    }
    row.actorCount = remaining.length;
    row.sampleActorIds = remaining.slice(0, 3).map(([id]) => id);
    row.lastActorUserId = remaining[remaining.length - 1][0];
    row.updatedAt = this.now();
  }

  async failOutbox(
    outboxId: string,
    leaseToken: string,
    error: string,
    retrySeconds: number,
    maxFailures: number,
  ): Promise<FailOutboxOutcome> {
    const o = this.outbox.get(Number(outboxId));
    if (!o || o.status !== 'claimed' || o.leaseToken !== leaseToken) return 'lease_lost';
    o.failureCount += 1;
    o.status = o.failureCount >= maxFailures ? 'dead' : 'pending';
    o.availableAt = this.now() + Math.max(retrySeconds, 0) * 1000;
    o.leaseToken = null;
    o.lastError = error.slice(0, 1000);
    return o.status === 'dead' ? 'dead' : 'retrying';
  }

  async sweep(maxClaims: number, batch: number): Promise<{ outboxDead: number }> {
    const now = this.now();
    const exhausted = [...this.outbox.values()]
      .filter(
        (o) =>
          (o.status === 'pending' || o.status === 'claimed') && o.availableAt <= now && o.claimCount >= maxClaims,
      )
      .slice(0, batch);
    for (const o of exhausted) {
      o.status = 'dead';
      o.leaseToken = null;
      o.lastError = o.lastError ?? 'claim_limit_exhausted';
    }
    return { outboxDead: exhausted.length };
  }

  async prune(args: RetentionArgs): Promise<PruneResult> {
    if (args.eventKeyDays <= args.staleAfterDays) {
      throw new Error('notification_prune: event key retention must exceed stale cutoff');
    }
    const now = this.now();
    let outboxProcessed = 0;
    let outboxDead = 0;
    let eventKeys = 0;
    let notifications = 0;
    for (const o of [...this.outbox.values()]) {
      if (o.status === 'processed' && (o.processedAt ?? 0) < now - args.outboxProcessedDays * DAY_MS && outboxProcessed < args.batch) {
        this.outbox.delete(o.id);
        outboxProcessed += 1;
      } else if (o.status === 'dead' && o.createdAt < now - args.outboxDeadDays * DAY_MS && outboxDead < args.batch) {
        this.outbox.delete(o.id);
        outboxDead += 1;
      }
    }
    for (const [key, value] of [...this.eventKeys.entries()]) {
      if (value.createdAt < now - args.eventKeyDays * DAY_MS && eventKeys < args.batch) {
        this.eventKeys.delete(key);
        eventKeys += 1;
      }
    }
    for (const n of [...this.notifications.values()]) {
      if (n.createdAt < now - args.inboxDays * DAY_MS && notifications < args.batch) {
        this.deleteNotification(n.id);
        notifications += 1;
      }
    }
    return { outboxProcessed, outboxDead, eventKeys, notifications };
  }

  private visibleFor(userId: string, now: number): NotificationRow[] {
    return [...this.notifications.values()].filter(
      (n) =>
        n.userId === userId && n.archivedAt === null && n.inboxVisible && (n.expiresAt === null || n.expiresAt > now),
    );
  }

  private static beforeOrAt(n: NotificationRow, cursor: { sortAt: string; id: string }, inclusive: boolean): boolean {
    const at = Date.parse(cursor.sortAt);
    if (n.sortAt !== at) return n.sortAt < at;
    return inclusive ? n.id <= cursor.id : n.id < cursor.id;
  }

  private toRecord(n: NotificationRow): NotificationRecord {
    return {
      id: n.id,
      userId: n.userId,
      type: n.type,
      category: n.category,
      title: n.title,
      body: n.body,
      data: n.data,
      deepLink: n.deepLink,
      groupKey: n.groupKey,
      actorCount: n.actorCount,
      sampleActorIds: [...n.sampleActorIds],
      sortAt: iso(n.sortAt) as string,
      seenAt: iso(n.seenAt),
      readAt: iso(n.readAt),
      createdAt: iso(n.createdAt) as string,
    };
  }

  async listFeed(userId: string, query: FeedQuery): Promise<NotificationRecord[]> {
    const now = this.now();
    return this.visibleFor(userId, now)
      .filter((n) => !query.category || n.category === query.category)
      .filter((n) => !query.before || InMemoryNotificationRepository.beforeOrAt(n, query.before, false))
      .sort((a, b) => b.sortAt - a.sortAt || b.id.localeCompare(a.id))
      .slice(0, Math.min(Math.max(query.limit, 1), 50))
      .map((n) => this.toRecord(n));
  }

  async unreadCount(userId: string): Promise<number> {
    return Math.min(
      100,
      this.visibleFor(userId, this.now()).filter((n) => n.readAt === null).length,
    );
  }

  async markRead(userId: string, selector: MarkReadSelector): Promise<number> {
    const now = this.now();
    let count = 0;
    for (const n of this.notifications.values()) {
      if (n.userId !== userId || n.readAt !== null || !n.inboxVisible) continue;
      if ('ids' in selector && !selector.ids.includes(n.id)) continue;
      if ('before' in selector && !InMemoryNotificationRepository.beforeOrAt(n, selector.before, true)) continue;
      n.readAt = now;
      n.seenAt = n.seenAt ?? now;
      n.updatedAt = now;
      count += 1;
    }
    return count;
  }

  async markSeen(userId: string, upTo: { sortAt: string; id: string }): Promise<number> {
    const now = this.now();
    let count = 0;
    for (const n of this.notifications.values()) {
      if (n.userId !== userId || n.seenAt !== null || !n.inboxVisible) continue;
      if (!InMemoryNotificationRepository.beforeOrAt(n, upTo, true)) continue;
      n.seenAt = now;
      n.updatedAt = now;
      count += 1;
    }
    return count;
  }

  async recordOpen(userId: string, notificationId: string): Promise<boolean> {
    const n = this.notifications.get(notificationId);
    if (!n || n.userId !== userId) return false;
    const now = this.now();
    n.readAt = n.readAt ?? now;
    n.seenAt = n.seenAt ?? now;
    n.updatedAt = now;
    return true;
  }

  async listPreferences(userId: string): Promise<PreferenceRow[]> {
    const rows: PreferenceRow[] = [];
    for (const [key, enabled] of this.preferences) {
      if (!key.startsWith(`${userId}:`)) continue;
      const [, category, channel] = key.split(':') as [string, NotificationCategory, NotificationChannel];
      rows.push({ category, channel, enabled });
    }
    return rows;
  }

  async replacePreferences(userId: string, rows: PreferenceRow[]): Promise<void> {
    for (const key of [...this.preferences.keys()]) {
      if (key.startsWith(`${userId}:`)) this.preferences.delete(key);
    }
    for (const row of rows) this.setPreference(userId, row.category, row.channel, row.enabled);
  }

  async getUserSettings(userId: string): Promise<{
    timezone: string | null;
    quietHours: QuietHours | null;
    promoOptedIn: boolean;
  }> {
    const stored = this.userSettings.get(userId);
    return {
      timezone: stored?.timezone ?? null,
      quietHours: stored?.quietHours ?? null,
      promoOptedIn: this.promoOptIn.has(userId),
    };
  }

  async upsertUserSettings(
    userId: string,
    patch: { timezone: string; quietHours: QuietHours | null; promoOptedIn: boolean },
  ): Promise<void> {
    this.userSettings.set(userId, { timezone: patch.timezone, quietHours: patch.quietHours });
    if (patch.promoOptedIn) this.promoOptIn.add(userId);
  }

  async getActiveActorProfiles(ids: string[]): Promise<ActorProfile[]> {
    return ids
      .map((id) => this.users.get(id))
      .filter(
        (u): u is UserRow =>
          Boolean(u) && (u!.accountStatus === 'CREATED' || u!.accountStatus === 'ACTIVE') && u!.deletedAt === null,
      )
      .map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        profilePhotoUrl: u.profilePhotoUrl,
      }));
  }

  async purgeUser(userId: string, batch: number): Promise<PurgeResult> {
    const limit = Math.min(Math.max(batch, 1), 1000);
    const own = [...this.notifications.values()].filter((n) => n.userId === userId).slice(0, limit);
    own.forEach((n) => this.deleteNotification(n.id));
    const ownOutbox = [...this.outbox.values()].filter((o) => o.recipientUserId === userId).slice(0, limit);
    ownOutbox.forEach((o) => this.outbox.delete(o.id));
    if (own.length < limit) {
      for (const key of [...this.preferences.keys()]) if (key.startsWith(`${userId}:`)) this.preferences.delete(key);
      this.promoOptIn.delete(userId);
      this.userSettings.delete(userId);
    }
    const actorRows = [...this.groupActors.entries()]
      .filter(([, actors]) => actors.has(userId))
      .map(([notificationId]) => notificationId)
      .filter((id) => this.notifications.has(id))
      .sort((a, b) => {
        const ua = this.notifications.get(a)!.userId;
        const ub = this.notifications.get(b)!.userId;
        return ua.localeCompare(ub) || a.localeCompare(b);
      })
      .slice(0, limit);
    actorRows.forEach((notificationId) => this.removeActor(notificationId, userId));
    let actorOutboxCleared = 0;
    for (const o of this.outbox.values()) {
      if (o.actorUserId === userId && (o.status === 'pending' || o.status === 'claimed')) {
        o.actorUserId = null;
        actorOutboxCleared += 1;
      }
    }
    return {
      notificationsDeleted: own.length,
      outboxDeleted: ownOutbox.length,
      actorRowsRemoved: actorRows.length,
      actorOutboxCleared,
      done: own.length < limit && ownOutbox.length < limit && actorRows.length < limit,
    };
  }

  async listRecentlyDeletedUserIds(sinceIso: string, limit: number): Promise<string[]> {
    const since = Date.parse(sinceIso);
    return [...this.users.values()]
      .filter((u) => u.accountStatus === 'DELETED' && u.deletedAt !== null && Date.parse(u.deletedAt) >= since)
      .slice(0, limit)
      .map((u) => u.id);
  }

  async materializeMany(
    items: {
      outboxId: string;
      leaseToken: string;
      render: MaterializeRender;
      push?: MaterializePush | null;
    }[],
  ): Promise<{ outcome: MaterializeOutcome; notificationId: string | null; deliveriesCreated?: number }[]> {
    const results = [];
    for (const item of items) {
      results.push(await this.materialize(item.outboxId, item.leaseToken, item.render, item.push));
    }
    return results;
  }

  async insertCampaign(
    campaign: Omit<NotificationCampaign, 'id' | 'status' | 'cursorUserId' | 'fannedOut'> & { id?: string },
  ): Promise<NotificationCampaign> {
    const row: NotificationCampaign = {
      id: campaign.id ?? randomUUID(),
      name: campaign.name,
      title: campaign.title,
      body: campaign.body,
      deepLink: campaign.deepLink,
      audience: campaign.audience,
      status: 'queued',
      cursorUserId: null,
      fannedOut: 0,
      occurredAt: campaign.occurredAt,
    };
    this.campaigns.set(row.id, row);
    return { ...row };
  }

  async getCampaign(id: string): Promise<NotificationCampaign | null> {
    const row = this.campaigns.get(id);
    return row ? { ...row } : null;
  }

  async listActiveCampaigns(): Promise<NotificationCampaign[]> {
    return [...this.campaigns.values()]
      .filter((c) => c.status === 'queued' || c.status === 'fanout')
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }

  async fanOutCampaign(id: string, batch: number): Promise<FanOutResult> {
    const campaign = this.campaigns.get(id);
    if (!campaign) throw new Error('campaign_not_found');
    if (campaign.status === 'completed' || campaign.status === 'cancelled') {
      return { fannedOut: 0, done: true, cursorUserId: campaign.cursorUserId };
    }
    const limit = Math.min(Math.max(batch, 1), 5000);
    const picked = this.audience(campaign.audience, campaign.cursorUserId, limit);
    let inserted = 0;
    for (const userId of picked) {
      const result = await this.enqueueEvent(
        {
          eventType: 'promo.broadcast',
          idempotencyKey: campaignIdempotencyKey(campaign.id, userId),
          recipientUserId: userId,
          actorUserId: null,
          occurredAt: campaign.occurredAt,
          payload: {
            campaignId: campaign.id,
            title: campaign.title,
            body: campaign.body,
            deepLink: campaign.deepLink,
          },
        },
        STALE_AFTER_SECONDS,
      );
      if (result.outcome === 'enqueued') inserted += 1;
    }
    campaign.cursorUserId = picked[picked.length - 1] ?? campaign.cursorUserId;
    campaign.fannedOut += inserted;
    campaign.status = picked.length < limit ? 'completed' : 'fanout';
    return { fannedOut: inserted, done: campaign.status === 'completed', cursorUserId: campaign.cursorUserId };
  }

  private audience(audience: CampaignAudience, cursor: string | null, batch: number): string[] {
    return [...this.users.values()]
      .filter((u) => {
        if (u.accountStatus !== 'ACTIVE' && u.accountStatus !== 'CREATED') return false;
        if (cursor && u.id <= cursor) return false;
        if (audience === 'promo_inbox') return this.channelEnabled(u.id, 'promo', 'inbox');
        if (audience === 'promo_push_opt_in') return this.channelEnabled(u.id, 'promo', 'push');
        return true;
      })
      .map((u) => u.id)
      .sort()
      .slice(0, batch);
  }

  async healthSnapshot(): Promise<NotificationHealthSnapshot> {
    const now = this.now();
    const due = [...this.outbox.values()]
      .filter((o) => (o.status === 'pending' || o.status === 'claimed') && o.availableAt <= now)
      .sort((a, b) => a.availableAt - b.availableAt || a.id - b.id);
    return {
      outboxOldestDueCreatedAt: due[0] ? iso(due[0].createdAt) : null,
      outboxDueCountCapped: Math.min(due.length, 10_000),
      outboxDeadCountCapped: Math.min([...this.outbox.values()].filter((o) => o.status === 'dead').length, 10_000),
    };
  }
}
