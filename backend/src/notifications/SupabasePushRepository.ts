import type { SupabaseClient } from '@supabase/supabase-js';
import type { BegunDelivery } from './domain/pushContent';
import type { ActorProfile, NotificationCategory } from './domain/types';
import { logger } from '../logger';
import {
  InstallationConflictError,
  RevocationUnavailableError,
  type ClaimedReceipt,
  type PushRegistrationInput,
  type PushRepository,
  type PushResultInput,
  type ReceiptResultInput,
  type RecordPushResultsSummary,
  type RecordReceiptsSummary,
  type RegisterPushResult,
} from './PushRepository';
import { SupabaseNotificationRepository } from './SupabaseNotificationRepository';

type BegunRow = {
  delivery_id: number | string;
  attempt_no: number;
  provider: string;
  token: string;
  token_fingerprint: string;
  platform: 'ios' | 'android';
  notification_id: string;
  type: string;
  category: NotificationCategory;
  title: string;
  body: string;
  deep_link: string | null;
  group_key: string | null;
  actor_count: number;
  sample_actor_ids: string[] | null;
  send_deadline: string;
};

/** PostgREST maps RAISE ... ERRCODE 'PT409' to HTTP 409 and surfaces the code. */
function isInstallationConflict(error: { code?: string; message?: string }): boolean {
  return error.code === 'PT409' || error.message === 'installation_conflict';
}

/** PGRST202: not in PostgREST's schema cache; 42883: undefined function. */
function isMissingFunction(error: { code?: string }): boolean {
  return error.code === 'PGRST202' || error.code === '42883';
}

class MissingFunctionError extends Error {
  constructor(fn: string) {
    super(`${fn}: function not found`);
    this.name = 'MissingFunctionError';
  }
}

const MISSING_FN_RETRY_MS = 5 * 60 * 1000;

type RegisterRow = {
  registration_id: number | string;
  previous_user_id: string | null;
  token_moved_from_user: string | null;
};

export class SupabasePushRepository implements PushRepository {
  private readonly profiles: SupabaseNotificationRepository;

  constructor(private readonly admin: SupabaseClient) {
    this.profiles = new SupabaseNotificationRepository(admin);
  }

  /** Set while the database lacks the revocation migration; re-probed after MISSING_FN_RETRY_MS. */
  private revocationMissingUntil = 0;

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.admin.rpc(fn, args);
    if (error) {
      if (fn.startsWith('notification_register_push') && isInstallationConflict(error)) {
        throw new InstallationConflictError();
      }
      if (isMissingFunction(error)) throw new MissingFunctionError(fn);
      throw new Error(`${fn}: ${error.message}`);
    }
    return data as T;
  }

  private revocationAvailable(): boolean {
    return Date.now() >= this.revocationMissingUntil;
  }

  private markRevocationMissing(): void {
    this.revocationMissingUntil = Date.now() + MISSING_FN_RETRY_MS;
    logger.warn({}, 'notification.push.revocation_migration_missing');
  }

  async claimDeliveries(
    provider: string,
    batch: number,
    leaseSeconds: number,
    maxClaims: number,
  ): Promise<{ dispatchToken: string; claimed: number } | null> {
    const data = await this.rpc<{ dispatch_token: string }[] | null>('notification_claim_push_deliveries', {
      p_provider: provider,
      p_batch: batch,
      p_lease_seconds: leaseSeconds,
      p_max_claims: maxClaims,
    });
    const first = data?.[0];
    return first ? { dispatchToken: first.dispatch_token, claimed: data.length } : null;
  }

  async beginSend(dispatchToken: string, sendLeaseSeconds: number): Promise<BegunDelivery[]> {
    const data = await this.rpc<BegunRow[] | null>('notification_begin_push_send', {
      p_dispatch_token: dispatchToken,
      p_send_lease_seconds: sendLeaseSeconds,
    });
    return (data ?? []).map((row) => ({
      deliveryId: String(row.delivery_id),
      attemptNo: row.attempt_no,
      provider: row.provider,
      token: row.token,
      tokenFingerprint: row.token_fingerprint,
      platform: row.platform,
      notificationId: row.notification_id,
      type: row.type,
      category: row.category,
      title: row.title,
      body: row.body,
      deepLink: row.deep_link,
      groupKey: row.group_key,
      actorCount: row.actor_count,
      sampleActorIds: row.sample_actor_ids ?? [],
      sendDeadline: row.send_deadline,
    }));
  }

  async recordResults(dispatchToken: string, results: PushResultInput[]): Promise<RecordPushResultsSummary> {
    const data = await this.rpc<Record<string, number>>('notification_record_push_results', {
      p_dispatch_token: dispatchToken,
      p_results: results.map((r) => ({
        delivery_id: Number(r.deliveryId),
        attempt_no: r.attemptNo,
        outcome_class: r.outcome.class,
        outcome_code: r.outcome.code,
        provider_code: r.outcome.providerCode,
        provider_message: r.outcome.providerMessage,
        http_status: r.outcome.httpStatus,
        retry_after_ms: r.outcome.retryAfterMs,
        provider_message_id: r.providerMessageId,
        latency_ms: Math.round(r.latencyMs),
      })),
    });
    return {
      recorded: data.recorded ?? 0,
      applied: data.applied ?? 0,
      duplicates: data.duplicates ?? 0,
      ignored: data.ignored ?? 0,
      registrationsInvalidated: data.registrations_invalidated ?? 0,
    };
  }

  async claimReceipts(provider: string, batch: number, leaseSeconds: number): Promise<ClaimedReceipt[]> {
    const data = await this.rpc<
      { receipt_token: string; attempt_id: number | string; provider_message_id: string }[] | null
    >('notification_claim_receipts', { p_provider: provider, p_batch: batch, p_lease_seconds: leaseSeconds });
    return (data ?? []).map((row) => ({
      receiptToken: row.receipt_token,
      attemptId: String(row.attempt_id),
      providerMessageId: row.provider_message_id,
    }));
  }

  async recordReceipts(receiptToken: string, results: ReceiptResultInput[]): Promise<RecordReceiptsSummary> {
    const data = await this.rpc<Record<string, number>>('notification_record_receipts', {
      p_receipt_token: receiptToken,
      p_results: results.map((r) =>
        r.outcome
          ? {
              attempt_id: Number(r.attemptId),
              found: true,
              outcome_class: r.outcome.class,
              outcome_code: r.outcome.code,
              provider_code: r.outcome.providerCode,
              provider_message: r.outcome.providerMessage,
              retry_after_ms: r.outcome.retryAfterMs,
            }
          : { attempt_id: Number(r.attemptId), found: false },
      ),
    });
    return {
      ok: data.ok ?? 0,
      errors: data.errors ?? 0,
      waiting: data.waiting ?? 0,
      unavailable: data.unavailable ?? 0,
      registrationsInvalidated: data.registrations_invalidated ?? 0,
    };
  }

  async register(userId: string, input: PushRegistrationInput, revocationHash: string): Promise<RegisterPushResult> {
    const args = {
      p_user_id: userId,
      p_installation_id: input.installationId,
      p_provider: input.provider,
      p_token: input.token,
      p_platform: input.platform,
      p_app_version: input.appVersion,
      p_app_build: input.appBuild,
      p_locale: input.locale,
      p_timezone: input.timezone,
      p_os_permission: input.osPermission,
      p_apns_environment: input.apnsEnvironment,
    };
    let data: RegisterRow[] | null = null;
    let revocationStored = false;
    if (this.revocationAvailable()) {
      try {
        data = await this.rpc<RegisterRow[]>('notification_register_push_with_revocation', {
          ...args,
          p_revocation_hash: revocationHash,
        });
        revocationStored = true;
      } catch (err) {
        if (!(err instanceof MissingFunctionError)) throw err;
        this.markRevocationMissing();
      }
    }
    if (!revocationStored) data = await this.rpc<RegisterRow[]>('notification_register_push', args);
    const row = data?.[0];
    if (!row) throw new Error('notification_register_push: empty result');
    return {
      registrationId: String(row.registration_id),
      previousUserId: row.previous_user_id,
      tokenMovedFromUserId: row.token_moved_from_user,
      revocationStored,
    };
  }

  async revokeInstallation(installationId: string, revocationHash: string): Promise<boolean> {
    try {
      return await this.rpc<boolean>('notification_revoke_installation', {
        p_installation_id: installationId,
        p_revocation_hash: revocationHash,
      });
    } catch (err) {
      if (err instanceof MissingFunctionError) throw new RevocationUnavailableError();
      throw err;
    }
  }

  async unregister(userId: string, installationId: string): Promise<number> {
    return this.rpc<number>('notification_unregister_installation', {
      p_user_id: userId,
      p_installation_id: installationId,
    });
  }

  async recordPushOpen(userId: string, notificationId: string, deliveryId: string, action: string | null): Promise<boolean> {
    return this.rpc<boolean>('notification_record_push_open', {
      p_user_id: userId,
      p_notification_id: notificationId,
      p_delivery_id: Number(deliveryId),
      p_action: action,
    });
  }

  getActiveActorProfiles(ids: string[]): Promise<ActorProfile[]> {
    return this.profiles.getActiveActorProfiles(ids);
  }
}
