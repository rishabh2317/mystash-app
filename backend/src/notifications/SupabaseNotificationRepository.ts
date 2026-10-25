import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationRepository, RetentionArgs } from './NotificationRepository';
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
  NotificationHealthSnapshot,
  NotificationRecord,
  PruneResult,
  PurgeResult,
  SweepResult,
} from './domain/types';
import type { MaterializePush } from './domain/pushPolicy';
import { normalizeClock, type PreferenceRow, type QuietHours } from './domain/preferencePolicy';
import type { FanOutResult, NotificationCampaign } from './domain/campaign';

type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  category: NotificationCategory;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  deep_link: string | null;
  group_key: string | null;
  actor_count: number;
  sample_actor_ids: string[] | null;
  sort_at: string;
  seen_at: string | null;
  read_at: string | null;
  created_at: string;
};

type ClaimRow = {
  outbox_id: number | string;
  lease_token: string;
  claim_count: number;
  event_type: string;
  schema_version: number;
  recipient_user_id: string;
  actor_user_id: string | null;
  occurred_at: string;
  payload: Record<string, unknown> | null;
};

function mapNotification(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    category: row.category,
    title: row.title,
    body: row.body,
    data: row.data ?? {},
    deepLink: row.deep_link,
    groupKey: row.group_key,
    actorCount: row.actor_count,
    sampleActorIds: row.sample_actor_ids ?? [],
    sortAt: row.sort_at,
    seenAt: row.seen_at,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  return (data as T | null) ?? null;
}

function mapCampaign(row: Record<string, unknown>): NotificationCampaign {
  return {
    id: String(row.id),
    name: String(row.name),
    title: String(row.title),
    body: String(row.body),
    deepLink: String(row.deep_link),
    audience: row.audience as NotificationCampaign['audience'],
    status: row.status as NotificationCampaign['status'],
    cursorUserId: row.cursor_user_id ? String(row.cursor_user_id) : null,
    fannedOut: Number(row.fanned_out ?? 0),
    occurredAt: String(row.occurred_at),
  };
}

export class SupabaseNotificationRepository implements NotificationRepository {
  constructor(private readonly admin: SupabaseClient) {}

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.admin.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  }

  async enqueueEvent(
    input: EnqueueEventInput,
    staleAfterSeconds: number,
  ): Promise<{ outboxId: string | null; outcome: EnqueueOutcome }> {
    const data = await this.rpc<unknown>('notification_enqueue_event', {
      p_event_type: input.eventType,
      p_idempotency_key: input.idempotencyKey,
      p_recipient_user_id: input.recipientUserId,
      p_actor_user_id: input.actorUserId,
      p_occurred_at: input.occurredAt,
      p_payload: input.payload,
      p_schema_version: input.schemaVersion ?? 1,
      p_stale_after_seconds: staleAfterSeconds,
    });
    const row = firstRow<{ outbox_id: number | string | null; outcome: EnqueueOutcome }>(data);
    if (!row) throw new Error('notification_enqueue_event: empty result');
    return { outboxId: row.outbox_id === null ? null : String(row.outbox_id), outcome: row.outcome };
  }

  async claimOutbox(batch: number, leaseSeconds: number, maxClaims: number): Promise<ClaimedOutboxEvent[]> {
    const data = await this.rpc<ClaimRow[] | null>('notification_claim_outbox', {
      p_batch: batch,
      p_lease_seconds: leaseSeconds,
      p_max_claims: maxClaims,
    });
    return (data ?? []).map((row) => ({
      outboxId: String(row.outbox_id),
      leaseToken: row.lease_token,
      claimCount: row.claim_count,
      eventType: row.event_type,
      schemaVersion: row.schema_version,
      recipientUserId: row.recipient_user_id,
      actorUserId: row.actor_user_id,
      occurredAt: row.occurred_at,
      payload: row.payload ?? {},
    }));
  }

  async materialize(
    outboxId: string,
    leaseToken: string,
    render: MaterializeRender,
    push?: MaterializePush | null,
  ): Promise<{ outcome: MaterializeOutcome; notificationId: string | null; deliveriesCreated?: number }> {
    const data = await this.rpc<unknown>('notification_materialize', {
      p_outbox_id: outboxId,
      p_lease_token: leaseToken,
      p_render: render,
      ...(push ? { p_push: push } : {}),
    });
    const row = firstRow<{ outcome: MaterializeOutcome; notification_id: string | null; deliveries_created?: number }>(
      data,
    );
    if (!row) throw new Error('notification_materialize: empty result');
    return { outcome: row.outcome, notificationId: row.notification_id, deliveriesCreated: row.deliveries_created };
  }

  async materializeMany(
    items: {
      outboxId: string;
      leaseToken: string;
      render: MaterializeRender;
      push?: MaterializePush | null;
    }[],
  ): Promise<{ outcome: MaterializeOutcome; notificationId: string | null; deliveriesCreated?: number }[]> {
    if (items.length === 0) return [];
    try {
      const data = await this.rpc<
        { outbox_id: number | string; outcome: MaterializeOutcome; notification_id: string | null; deliveries_created?: number }[]
      >('notification_materialize_many', {
        p_items: items.map((item) => ({
          outbox_id: item.outboxId,
          lease_token: item.leaseToken,
          render: item.render,
          ...(item.push ? { push: item.push } : {}),
        })),
      });
      return (data ?? []).map((row) => ({
        outcome: row.outcome,
        notificationId: row.notification_id,
        deliveriesCreated: row.deliveries_created,
      }));
    } catch (err) {
      const message = (err as Error).message ?? '';
      if (!message.includes('notification_materialize_many') && !message.includes('PGRST202')) throw err;
      const results = [];
      for (const item of items) {
        results.push(await this.materialize(item.outboxId, item.leaseToken, item.render, item.push));
      }
      return results;
    }
  }

  async insertCampaign(
    campaign: Omit<NotificationCampaign, 'id' | 'status' | 'cursorUserId' | 'fannedOut'> & { id?: string },
  ): Promise<NotificationCampaign> {
    const { data, error } = await this.admin
      .from('notification_campaigns')
      .insert({
        ...(campaign.id ? { id: campaign.id } : {}),
        name: campaign.name,
        title: campaign.title,
        body: campaign.body,
        deep_link: campaign.deepLink,
        audience: campaign.audience,
        occurred_at: campaign.occurredAt,
      })
      .select('*')
      .single();
    if (error || !data) throw new Error(`notification_campaigns.insert: ${error?.message ?? 'empty'}`);
    return mapCampaign(data as Record<string, unknown>);
  }

  async getCampaign(id: string): Promise<NotificationCampaign | null> {
    const { data, error } = await this.admin.from('notification_campaigns').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`notification_campaigns.select: ${error.message}`);
    return data ? mapCampaign(data as Record<string, unknown>) : null;
  }

  async listActiveCampaigns(): Promise<NotificationCampaign[]> {
    const { data, error } = await this.admin
      .from('notification_campaigns')
      .select('*')
      .in('status', ['queued', 'fanout'])
      .order('created_at', { ascending: true });
    if (error) throw new Error(`notification_campaigns.select: ${error.message}`);
    return (data ?? []).map((row) => mapCampaign(row as Record<string, unknown>));
  }

  async fanOutCampaign(id: string, batch: number): Promise<FanOutResult> {
    const data = await this.rpc<unknown>('notification_fan_out_campaign', {
      p_campaign_id: id,
      p_batch: batch,
    });
    const row = firstRow<{ fanned_out: number; done: boolean; cursor_user_id: string | null }>(data);
    if (!row) throw new Error('notification_fan_out_campaign: empty result');
    return { fannedOut: row.fanned_out, done: row.done, cursorUserId: row.cursor_user_id };
  }

  async failOutbox(
    outboxId: string,
    leaseToken: string,
    error: string,
    retrySeconds: number,
    maxFailures: number,
  ): Promise<FailOutboxOutcome> {
    return this.rpc<FailOutboxOutcome>('notification_fail_outbox', {
      p_outbox_id: outboxId,
      p_lease_token: leaseToken,
      p_error: error,
      p_retry_seconds: retrySeconds,
      p_max_failures: maxFailures,
    });
  }

  async sweep(maxClaims: number, batch: number): Promise<SweepResult> {
    const data = await this.rpc<{
      outbox_dead: number;
      deliveries_expired?: number;
      deliveries_failed_dispatch?: number;
      sending_abandoned?: number;
    }>('notification_sweep', {
      p_max_claims: maxClaims,
      p_batch: batch,
    });
    return {
      outboxDead: data.outbox_dead,
      deliveriesExpired: data.deliveries_expired,
      deliveriesFailedDispatch: data.deliveries_failed_dispatch,
      sendingAbandoned: data.sending_abandoned,
    };
  }

  async prune(args: RetentionArgs): Promise<PruneResult> {
    const data = await this.rpc<{
      outbox_processed: number;
      outbox_dead: number;
      event_keys: number;
      notifications: number;
      deliveries?: number;
      registrations?: number;
    }>('notification_prune', {
      p_batch: args.batch,
      p_outbox_processed_days: args.outboxProcessedDays,
      p_outbox_dead_days: args.outboxDeadDays,
      p_event_key_days: args.eventKeyDays,
      p_stale_after_days: args.staleAfterDays,
      p_inbox_days: args.inboxDays,
    });
    return {
      outboxProcessed: data.outbox_processed,
      outboxDead: data.outbox_dead,
      eventKeys: data.event_keys,
      notifications: data.notifications,
      deliveries: data.deliveries,
      registrations: data.registrations,
    };
  }

  async listFeed(userId: string, query: FeedQuery): Promise<NotificationRecord[]> {
    const data = await this.rpc<NotificationRow[] | null>('notification_list_feed', {
      p_user_id: userId,
      p_before_sort_at: query.before?.sortAt ?? null,
      p_before_id: query.before?.id ?? null,
      p_limit: query.limit,
      p_category: query.category,
    });
    return (data ?? []).map(mapNotification);
  }

  async unreadCount(userId: string): Promise<number> {
    return this.rpc<number>('notification_unread_count', { p_user_id: userId });
  }

  async markRead(userId: string, selector: MarkReadSelector): Promise<number> {
    return this.rpc<number>('notification_mark_read', {
      p_user_id: userId,
      p_ids: 'ids' in selector ? selector.ids : null,
      p_before_sort_at: 'before' in selector ? selector.before.sortAt : null,
      p_before_id: 'before' in selector ? selector.before.id : null,
    });
  }

  async markSeen(userId: string, upTo: { sortAt: string; id: string }): Promise<number> {
    return this.rpc<number>('notification_mark_seen', {
      p_user_id: userId,
      p_before_sort_at: upTo.sortAt,
      p_before_id: upTo.id,
    });
  }

  async recordOpen(userId: string, notificationId: string): Promise<boolean> {
    return this.rpc<boolean>('notification_record_open', {
      p_user_id: userId,
      p_notification_id: notificationId,
    });
  }

  async listPreferences(userId: string): Promise<PreferenceRow[]> {
    const { data, error } = await this.admin
      .from('notification_preferences')
      .select('category, channel, enabled')
      .eq('user_id', userId);
    if (error) throw new Error(`notification_preferences.select: ${error.message}`);
    return ((data ?? []) as PreferenceRow[]).map((row) => ({
      category: row.category,
      channel: row.channel,
      enabled: Boolean(row.enabled),
    }));
  }

  async replacePreferences(userId: string, rows: PreferenceRow[]): Promise<void> {
    const { error: delError } = await this.admin.from('notification_preferences').delete().eq('user_id', userId);
    if (delError) throw new Error(`notification_preferences.delete: ${delError.message}`);
    if (rows.length === 0) return;
    const { error } = await this.admin.from('notification_preferences').insert(
      rows.map((row) => ({
        user_id: userId,
        category: row.category,
        channel: row.channel,
        enabled: row.enabled,
      })),
    );
    if (error) throw new Error(`notification_preferences.insert: ${error.message}`);
  }

  async getUserSettings(userId: string): Promise<{
    timezone: string | null;
    quietHours: QuietHours | null;
    promoOptedIn: boolean;
  }> {
    const { data, error } = await this.admin
      .from('user_notification_settings')
      .select('timezone, quiet_hours_start, quiet_hours_end, promo_opt_in_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`user_notification_settings.select: ${error.message}`);
    const row = data as {
      timezone: string | null;
      quiet_hours_start: string | null;
      quiet_hours_end: string | null;
      promo_opt_in_at: string | null;
    } | null;
    const start = row?.quiet_hours_start ? normalizeClock(String(row.quiet_hours_start).slice(0, 8)) : null;
    const end = row?.quiet_hours_end ? normalizeClock(String(row.quiet_hours_end).slice(0, 8)) : null;
    return {
      timezone: row?.timezone ?? null,
      quietHours: start && end ? { start, end } : null,
      promoOptedIn: Boolean(row?.promo_opt_in_at),
    };
  }

  async upsertUserSettings(
    userId: string,
    patch: { timezone: string; quietHours: QuietHours | null; promoOptedIn: boolean },
  ): Promise<void> {
    const existing = await this.getUserSettings(userId);
    const promoAt = existing.promoOptedIn
      ? undefined
      : patch.promoOptedIn
        ? new Date().toISOString()
        : null;
    const row: Record<string, unknown> = {
      user_id: userId,
      timezone: patch.timezone,
      quiet_hours_start: patch.quietHours?.start ?? null,
      quiet_hours_end: patch.quietHours?.end ?? null,
      updated_at: new Date().toISOString(),
    };
    if (promoAt !== undefined) row.promo_opt_in_at = promoAt;
    const { error } = await this.admin.from('user_notification_settings').upsert(row, { onConflict: 'user_id' });
    if (error) throw new Error(`user_notification_settings.upsert: ${error.message}`);
  }

  async getActiveActorProfiles(ids: string[]): Promise<ActorProfile[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.admin
      .from('users')
      .select('id, username, display_name, profile_photo_url')
      .in('id', ids)
      .in('account_status', ['CREATED', 'ACTIVE'])
      .is('deleted_at', null);
    if (error) throw new Error(`users.select: ${error.message}`);
    return (
      (data ?? []) as {
        id: string;
        username: string;
        display_name: string | null;
        profile_photo_url: string | null;
      }[]
    ).map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      profilePhotoUrl: row.profile_photo_url,
    }));
  }

  async purgeUser(userId: string, batch: number): Promise<PurgeResult> {
    const data = await this.rpc<{
      notifications_deleted: number;
      outbox_deleted: number;
      actor_rows_removed: number;
      actor_outbox_cleared: number;
      done: boolean;
    }>('notification_purge_user', { p_user_id: userId, p_batch: batch });
    return {
      notificationsDeleted: data.notifications_deleted,
      outboxDeleted: data.outbox_deleted,
      actorRowsRemoved: data.actor_rows_removed,
      actorOutboxCleared: data.actor_outbox_cleared,
      done: data.done,
    };
  }

  async listRecentlyDeletedUserIds(sinceIso: string, limit: number): Promise<string[]> {
    const { data, error } = await this.admin
      .from('users')
      .select('id')
      .eq('account_status', 'DELETED')
      .gte('deleted_at', sinceIso)
      .order('deleted_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`users.select: ${error.message}`);
    return ((data ?? []) as { id: string }[]).map((row) => row.id);
  }

  async healthSnapshot(): Promise<NotificationHealthSnapshot> {
    const data = await this.rpc<{
      outbox_oldest_due_created_at: string | null;
      outbox_due_count_capped: number;
      outbox_dead_count_capped: number;
      push_oldest_due_available_at?: string | null;
      push_stuck_sending_count_capped?: number;
      push_receipts_overdue_count_capped?: number;
    }>('notification_health_snapshot', {});
    return {
      outboxOldestDueCreatedAt: data.outbox_oldest_due_created_at,
      outboxDueCountCapped: data.outbox_due_count_capped,
      outboxDeadCountCapped: data.outbox_dead_count_capped,
      pushOldestDueAvailableAt: data.push_oldest_due_available_at,
      pushStuckSendingCountCapped: data.push_stuck_sending_count_capped,
      pushReceiptsOverdueCountCapped: data.push_receipts_overdue_count_capped,
    };
  }
}
