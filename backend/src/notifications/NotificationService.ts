import { logger } from '../logger';
import type { NotificationRepository } from './NotificationRepository';
import { isNotificationEventType, NOTIFICATION_TYPES } from './domain/eventTypes';
import { CAMPAIGN_FANOUT, PURGE_BATCH, STALE_AFTER_SECONDS } from './domain/policy';
import { parseCampaignDraft, type FanOutResult, type NotificationCampaign } from './domain/campaign';
import { decodeFeedCursor, encodeFeedCursor, toNotificationView } from './domain/render';
import {
  CONFIGURABLE_PAIRS,
  defaultEnabled,
  isConfigurablePair,
  isIanaTimeZone,
  normalizeClock,
  resolveSettings,
  type NotificationSettingsState,
  type PreferenceRow,
  type QuietHours,
} from './domain/preferencePolicy';
import type {
  EnqueueEventInput,
  EnqueueOutcome,
  NotificationCategory,
  NotificationView,
  PurgeResult,
} from './domain/types';

export class NotificationServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'NotificationServiceError';
  }
}

const CATEGORIES: readonly NotificationCategory[] = ['social', 'task', 'account', 'security', 'promo'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PURGE_ROUNDS = 1_000;

/** `headCursor` is the first item's cursor, for `markSeen` / mark-all-read up to what was shown. */
export type FeedPage = { items: NotificationView[]; nextCursor: string | null; headCursor: string | null };

export type MarkReadRequest = { ids?: unknown; all?: unknown; before?: unknown };

export class NotificationService {
  constructor(private readonly repo: NotificationRepository) {}

  /** Producers: throws on invalid input; deduplication is decided by the database. */
  async emit(input: EnqueueEventInput): Promise<EnqueueOutcome> {
    if (!isNotificationEventType(input.eventType)) {
      throw new NotificationServiceError(`Unknown notification event type ${input.eventType}`);
    }
    const def = NOTIFICATION_TYPES[input.eventType];
    if (def.requiresActor && !input.actorUserId) {
      throw new NotificationServiceError(`${input.eventType} requires an actor`);
    }
    if (Number.isNaN(Date.parse(input.occurredAt))) {
      throw new NotificationServiceError('occurredAt must be an ISO timestamp');
    }
    def.render(input.payload);
    const { outcome } = await this.repo.enqueueEvent(input, STALE_AFTER_SECONDS);
    return outcome;
  }

  /** Producers that must never fail their own write because of notifications. */
  async emitSafely(input: EnqueueEventInput): Promise<EnqueueOutcome | null> {
    try {
      return await this.emit(input);
    } catch (err) {
      logger.warn(
        { eventType: input.eventType, message: (err as Error).message?.slice(0, 200) },
        'notification.emit_failed',
      );
      return null;
    }
  }

  async listFeed(
    userId: string,
    params: { cursor?: string | null; limit?: number | null; category?: string | null },
  ): Promise<FeedPage> {
    const limit = Math.min(Math.max(Math.trunc(params.limit ?? 20) || 20, 1), 50);
    let before = null;
    if (params.cursor) {
      before = decodeFeedCursor(params.cursor);
      if (!before) throw new NotificationServiceError('Invalid cursor');
    }
    let category: NotificationCategory | null = null;
    if (params.category) {
      if (!CATEGORIES.includes(params.category as NotificationCategory)) {
        throw new NotificationServiceError('Invalid category');
      }
      category = params.category as NotificationCategory;
    }

    const records = await this.repo.listFeed(userId, { before, limit, category });
    const actorIds = [...new Set(records.flatMap((r) => r.sampleActorIds))];
    const actors = await this.repo.getActiveActorProfiles(actorIds);
    const actorsById = new Map(actors.map((a) => [a.id, a]));
    const first = records[0];
    const last = records[records.length - 1];
    return {
      items: records.map((r) => toNotificationView(r, actorsById)),
      nextCursor: records.length === limit && last ? encodeFeedCursor({ sortAt: last.sortAt, id: last.id }) : null,
      headCursor: first ? encodeFeedCursor({ sortAt: first.sortAt, id: first.id }) : null,
    };
  }

  async unreadCount(userId: string): Promise<{ unread: number; capped: boolean }> {
    const unread = await this.repo.unreadCount(userId);
    return { unread, capped: unread >= 100 };
  }

  async markRead(userId: string, body: MarkReadRequest): Promise<{ updated: number }> {
    if (Array.isArray(body.ids)) {
      const ids = body.ids.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id));
      if (ids.length === 0 || ids.length !== body.ids.length || ids.length > 100) {
        throw new NotificationServiceError('ids must be 1–100 notification ids');
      }
      return { updated: await this.repo.markRead(userId, { ids }) };
    }
    if (body.all === true) {
      if (typeof body.before === 'string') {
        const before = decodeFeedCursor(body.before);
        if (!before) throw new NotificationServiceError('Invalid cursor');
        return { updated: await this.repo.markRead(userId, { before }) };
      }
      return { updated: await this.repo.markRead(userId, { all: true }) };
    }
    throw new NotificationServiceError('Provide ids or all: true');
  }

  async markSeen(userId: string, upTo: unknown): Promise<{ updated: number }> {
    const cursor = typeof upTo === 'string' ? decodeFeedCursor(upTo) : null;
    if (!cursor) throw new NotificationServiceError('upTo must be a feed cursor');
    return { updated: await this.repo.markSeen(userId, cursor) };
  }

  async getSettings(userId: string): Promise<NotificationSettingsState> {
    const [stored, settings] = await Promise.all([
      this.repo.listPreferences(userId),
      this.repo.getUserSettings(userId),
    ]);
    return resolveSettings({ stored, ...settings });
  }

  async updateSettings(userId: string, body: Record<string, unknown>): Promise<NotificationSettingsState> {
    const current = await this.getSettings(userId);
    const preferences = parsePreferencePatch(body.preferences, current.preferences);
    const timezone =
      body.timezone === undefined
        ? current.timezone
        : typeof body.timezone === 'string' && isIanaTimeZone(body.timezone)
          ? body.timezone
          : (() => {
              throw new NotificationServiceError('timezone must be an IANA time zone');
            })();
    const quietHours = parseQuietHoursPatch(body.quietHours, current.quietHours);
    const promoPush = preferences.find((p) => p.category === 'promo' && p.channel === 'push')?.enabled ?? false;
    await this.repo.replacePreferences(userId, preferences);
    await this.repo.upsertUserSettings(userId, {
      timezone,
      quietHours,
      promoOptedIn: current.promoOptedIn || promoPush,
    });
    return this.getSettings(userId);
  }

  async recordOpen(userId: string, notificationId: string): Promise<void> {
    if (!UUID_RE.test(notificationId)) throw new NotificationServiceError('Notification not found', 404);
    const ok = await this.repo.recordOpen(userId, notificationId);
    if (!ok) throw new NotificationServiceError('Notification not found', 404);
  }

  async getCampaign(id: string): Promise<NotificationCampaign> {
    if (!UUID_RE.test(id)) throw new NotificationServiceError('Campaign not found', 404);
    const campaign = await this.repo.getCampaign(id);
    if (!campaign) throw new NotificationServiceError('Campaign not found', 404);
    return campaign;
  }

  async createCampaign(body: Record<string, unknown>): Promise<NotificationCampaign> {
    let draft;
    try {
      const occurredAt =
        typeof body.occurredAt === 'string' && !Number.isNaN(Date.parse(body.occurredAt))
          ? body.occurredAt
          : new Date().toISOString();
      draft = parseCampaignDraft(body, occurredAt);
    } catch (err) {
      throw new NotificationServiceError((err as Error).message);
    }
    return this.repo.insertCampaign(draft);
  }

  async fanOutCampaign(id: string, batch: number = CAMPAIGN_FANOUT.batch): Promise<FanOutResult> {
    if (!UUID_RE.test(id)) throw new NotificationServiceError('Campaign not found', 404);
    const campaign = await this.repo.getCampaign(id);
    if (!campaign) throw new NotificationServiceError('Campaign not found', 404);
    const size = Math.min(Math.max(Math.trunc(batch) || CAMPAIGN_FANOUT.batch, 1), CAMPAIGN_FANOUT.batchMax);
    return this.repo.fanOutCampaign(id, size);
  }

  /** Fans out every queued/in-flight campaign by one batch. */
  async fanOutDueCampaigns(batch: number = CAMPAIGN_FANOUT.batch): Promise<number> {
    const due = await this.repo.listActiveCampaigns();
    let total = 0;
    for (const campaign of due) {
      const result = await this.repo.fanOutCampaign(campaign.id, batch);
      total += result.fannedOut;
    }
    return total;
  }

  /** Runs `notification_purge_user` until done; safe to repeat. */
  async purgeUser(userId: string): Promise<PurgeResult> {
    const total: PurgeResult = {
      notificationsDeleted: 0,
      outboxDeleted: 0,
      actorRowsRemoved: 0,
      actorOutboxCleared: 0,
      done: false,
    };
    for (let round = 0; round < MAX_PURGE_ROUNDS && !total.done; round += 1) {
      const step = await this.repo.purgeUser(userId, PURGE_BATCH);
      total.notificationsDeleted += step.notificationsDeleted;
      total.outboxDeleted += step.outboxDeleted;
      total.actorRowsRemoved += step.actorRowsRemoved;
      total.actorOutboxCleared += step.actorOutboxCleared;
      total.done = step.done;
    }
    return total;
  }
}

function parsePreferencePatch(raw: unknown, fallback: PreferenceRow[]): PreferenceRow[] {
  if (raw === undefined) {
    return CONFIGURABLE_PAIRS.map((pair) => {
      const match = fallback.find((row) => row.category === pair.category && row.channel === pair.channel);
      return { ...pair, enabled: match?.enabled ?? defaultEnabled(pair) };
    });
  }
  if (!Array.isArray(raw) || raw.length > CONFIGURABLE_PAIRS.length) {
    throw new NotificationServiceError('preferences must be the configurable category/channel pairs');
  }
  const seen = new Set<string>();
  const rows: PreferenceRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') throw new NotificationServiceError('Invalid preference');
    const row = item as Record<string, unknown>;
    if (typeof row.category !== 'string' || typeof row.channel !== 'string' || typeof row.enabled !== 'boolean') {
      throw new NotificationServiceError('Each preference needs category, channel and enabled');
    }
    if (!isConfigurablePair(row.category, row.channel)) {
      throw new NotificationServiceError('That notification setting cannot be changed');
    }
    const key = `${row.category}:${row.channel}`;
    if (seen.has(key)) throw new NotificationServiceError('Duplicate preference');
    seen.add(key);
    rows.push({
      category: row.category as PreferenceRow['category'],
      channel: row.channel as PreferenceRow['channel'],
      enabled: row.enabled,
    });
  }
  return CONFIGURABLE_PAIRS.map((pair) => {
    const match = rows.find((row) => row.category === pair.category && row.channel === pair.channel);
    const fallbackRow = fallback.find((row) => row.category === pair.category && row.channel === pair.channel);
    return { ...pair, enabled: match?.enabled ?? fallbackRow?.enabled ?? defaultEnabled(pair) };
  });
}

function parseQuietHoursPatch(raw: unknown, fallback: QuietHours | null): QuietHours | null {
  if (raw === undefined) return fallback;
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object') throw new NotificationServiceError('quietHours must be { start, end } or null');
  const body = raw as Record<string, unknown>;
  if (typeof body.start !== 'string' || typeof body.end !== 'string') {
    throw new NotificationServiceError('quietHours needs start and end as HH:MM');
  }
  const start = normalizeClock(body.start);
  const end = normalizeClock(body.end);
  if (!start || !end) throw new NotificationServiceError('quietHours times must be HH:MM');
  if (start === end) throw new NotificationServiceError('quietHours start and end must differ');
  return { start, end };
}
