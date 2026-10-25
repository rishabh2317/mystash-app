import { logger } from '../../logger';
import { buildPushMessage, type BegunDelivery } from '../domain/pushContent';
import { PUSH_DISPATCH_POLICY } from '../domain/pushPolicy';
import type { ActorProfile } from '../domain/types';
import type { PushRepository, PushResultInput } from '../PushRepository';
import { outcome, type PushMessage, type PushProvider } from '../providers/types';

export type DispatcherStats = { lastRunAt: string | null; lastSentAt: string | null; lastError: string | null };

async function actorsFor(repo: PushRepository, begun: BegunDelivery[]): Promise<Map<string, ActorProfile>> {
  const ids = [...new Set(begun.filter((d) => d.category === 'social').flatMap((d) => d.sampleActorIds))];
  const profiles = ids.length ? await repo.getActiveActorProfiles(ids) : [];
  return new Map(profiles.map((p) => [p.id, p]));
}

/**
 * Claim -> begin -> send -> record, all fenced by one dispatch token. If the process dies between
 * send and record, the lease expires and the sweeper applies the ambiguous (worker_lost) rule.
 */
export async function runDispatchOnce(
  repo: PushRepository,
  provider: PushProvider,
  now: () => number = () => Date.now(),
): Promise<number> {
  const claim = await repo.claimDeliveries(
    provider.name,
    Math.min(PUSH_DISPATCH_POLICY.claimBatch, provider.maxBatchSize),
    PUSH_DISPATCH_POLICY.leaseSeconds,
    PUSH_DISPATCH_POLICY.maxClaims,
  );
  if (!claim) return 0;

  const begun = await repo.beginSend(claim.dispatchToken, PUSH_DISPATCH_POLICY.sendLeaseSeconds);
  if (begun.length === 0) return claim.claimed;

  const actors = await actorsFor(repo, begun);
  const results: PushResultInput[] = [];
  const messages: PushMessage[] = [];
  for (const delivery of begun) {
    const message = buildPushMessage(delivery, actors, now());
    if (message) {
      messages.push(message);
    } else {
      results.push({
        deliveryId: delivery.deliveryId,
        attemptNo: delivery.attemptNo,
        outcome: outcome('permanent_message', 'payload_too_large', { providerCode: 'LOCAL_PAYLOAD_LIMIT' }),
        providerMessageId: null,
        latencyMs: 0,
      });
    }
  }

  if (messages.length > 0) {
    const sent = await provider
      .send(messages, AbortSignal.timeout(PUSH_DISPATCH_POLICY.requestTimeoutMs))
      .catch(() => [] as Awaited<ReturnType<PushProvider['send']>>);
    const byDelivery = new Map(sent.map((r) => [`${r.deliveryId}:${r.attemptNo}`, r]));
    for (const m of messages) {
      results.push(
        byDelivery.get(`${m.deliveryId}:${m.attemptNo}`) ?? {
          deliveryId: m.deliveryId,
          attemptNo: m.attemptNo,
          outcome: outcome('ambiguous', 'response_mismatch'),
          providerMessageId: null,
          latencyMs: 0,
        },
      );
    }
  }

  const summary = await repo.recordResults(claim.dispatchToken, results);
  const byClass: Record<string, number> = {};
  for (const r of results) {
    const key = `${r.outcome.class}:${r.outcome.code}`;
    byClass[key] = (byClass[key] ?? 0) + 1;
  }
  logger.info({ provider: provider.name, sent: messages.length, outcomes: byClass, ...summary }, 'notification.push.batch');
  if (results.some((r) => r.outcome.class === 'provider_config')) {
    logger.error({ provider: provider.name, outcomes: byClass }, 'notification.push.provider_config');
  }
  return claim.claimed;
}

export type DispatcherHandle = { stop(): Promise<void>; stats(): DispatcherStats };

/** DB-leased loop; one batch in flight per process keeps Expo connections well under 6. */
export function startPushDispatcher(repo: PushRepository, provider: PushProvider): DispatcherHandle {
  const stats: DispatcherStats = { lastRunAt: null, lastSentAt: null, lastError: null };
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;

  const loop = async (): Promise<void> => {
    if (stopped) return;
    let claimed = 0;
    try {
      claimed = await runDispatchOnce(repo, provider);
      stats.lastRunAt = new Date().toISOString();
      if (claimed > 0) stats.lastSentAt = stats.lastRunAt;
      stats.lastError = null;
    } catch (err) {
      stats.lastError = ((err as Error).message ?? 'unknown').slice(0, 200);
      logger.warn({ message: stats.lastError }, 'notification.push.dispatch_failed');
    }
    if (stopped) return;
    const delay = claimed >= PUSH_DISPATCH_POLICY.claimBatch ? 0 : PUSH_DISPATCH_POLICY.idlePollMs;
    timer = setTimeout(() => {
      running = loop();
    }, delay);
  };

  running = loop();
  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
    stats: () => ({ ...stats }),
  };
}
