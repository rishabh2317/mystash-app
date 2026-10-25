import { createServer, type Server } from 'node:http';
import express from 'express';
import { InMemoryNotificationRepository } from '../InMemoryNotificationRepository';
import { NotificationService } from '../NotificationService';
import { STALE_AFTER_SECONDS } from '../domain/policy';
import { buildMaterializeRender } from '../domain/eventTypes';
import {
  createListNotificationsHandler,
  createMarkReadHandler,
  createUnreadCountHandler,
} from '../routes';
import { runMaterializerOnce } from './outboxMaterializer';
import { FakePushProvider } from '../providers/FakePushProvider';
import type { PushMessage } from '../providers/types';
import { runPruneOnce } from './notificationMaintenance';

const INGEST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

export type Percentiles = { p50: number; p95: number; n: number; max: number };

export function percentiles(samples: number[]): Percentiles {
  if (samples.length === 0) return { p50: 0, p95: 0, n: 0, max: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
  return { p50: at(0.5), p95: at(0.95), n: samples.length, max: sorted[sorted.length - 1]! };
}

export function recipientId(index = 0): string {
  return `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`;
}

export async function seedInbox(
  repo: InMemoryNotificationRepository,
  count: number,
  userId: string,
  occurredAt: string,
): Promise<void> {
  repo.addUser(userId);
  for (let i = 0; i < count; i += 1) {
    await repo.enqueueEvent(
      {
        eventType: 'ingest.failed',
        idempotencyKey: `load:${i}`,
        recipientUserId: userId,
        actorUserId: null,
        occurredAt,
        payload: { ingestId: INGEST },
      },
      STALE_AFTER_SECONDS,
    );
  }
  while ((await runMaterializerOnce(repo, { claimBatch: 500, leaseSeconds: 60, maxClaims: 10, concurrency: 16 })) > 0) {
    /* drain */
  }
}

export async function withFeedServer(
  repo: InMemoryNotificationRepository,
  userId: string,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  const deps = {
    service: new NotificationService(repo),
    authenticate: async () => ({ userId }),
  };
  app.get('/users/me/notifications', createListNotificationsHandler(deps));
  app.get('/users/me/notifications/unread-count', createUnreadCountHandler(deps));
  app.post('/users/me/notifications/read', createMarkReadHandler(deps));
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export async function timedRequests(
  work: () => Promise<void>,
  { requests, concurrency }: { requests: number; concurrency: number },
): Promise<number[]> {
  const samples: number[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, requests) }, async () => {
    while (next < requests) {
      next += 1;
      const start = performance.now();
      await work();
      samples.push(performance.now() - start);
    }
  });
  await Promise.all(workers);
  return samples;
}

export type FeedLoadResult = {
  list: Percentiles;
  unread: Percentiles;
  read: Percentiles;
};

export async function runFeedLoad(opts: {
  feedSize: number;
  requests: number;
  concurrency: number;
}): Promise<FeedLoadResult> {
  const userId = recipientId();
  const repo = new InMemoryNotificationRepository();
  await seedInbox(repo, opts.feedSize, userId, new Date().toISOString());
  const page = await new NotificationService(repo).listFeed(userId, { limit: 1 });
  const firstId = page.items[0]?.id;
  let result: FeedLoadResult = {
    list: { p50: 0, p95: 0, n: 0, max: 0 },
    unread: { p50: 0, p95: 0, n: 0, max: 0 },
    read: { p50: 0, p95: 0, n: 0, max: 0 },
  };
  await withFeedServer(repo, userId, async (baseUrl) => {
    const headers = { authorization: 'Bearer load', 'content-type': 'application/json' };
    result = {
      list: percentiles(
        await timedRequests(
          async () => {
            const res = await fetch(`${baseUrl}/users/me/notifications?limit=20`, { headers });
            if (!res.ok) throw new Error(`list ${res.status}`);
            await res.json();
          },
          opts,
        ),
      ),
      unread: percentiles(
        await timedRequests(
          async () => {
            const res = await fetch(`${baseUrl}/users/me/notifications/unread-count`, { headers });
            if (!res.ok) throw new Error(`unread ${res.status}`);
            await res.json();
          },
          opts,
        ),
      ),
      read: percentiles(
        await timedRequests(
          async () => {
            const res = await fetch(`${baseUrl}/users/me/notifications/read`, {
              method: 'POST',
              headers,
              body: JSON.stringify(firstId ? { ids: [firstId] } : { all: true }),
            });
            if (!res.ok) throw new Error(`read ${res.status}`);
            await res.json();
          },
          opts,
        ),
      ),
    };
  });
  return result;
}

export type BurstResult = {
  enqueued: number;
  materialized: number;
  restartedAfter: number;
  fakePushBatches: number;
  fakePushMessages: number;
  pruneMs: number;
  drainMs: number;
  redisUsed: false;
};

export async function runOutboxBurst(opts: {
  count: number;
  restartAfter: number;
  leaseSeconds?: number;
}): Promise<BurstResult> {
  const leaseSeconds = opts.leaseSeconds ?? 60;
  const userId = recipientId();
  let clock = Date.parse('2026-10-12T08:00:00.000Z');
  const repo = new InMemoryNotificationRepository(() => clock);
  repo.addUser(userId);
  const occurredAt = new Date(clock).toISOString();
  for (let i = 0; i < opts.count; i += 1) {
    await repo.enqueueEvent(
      {
        eventType: 'ingest.failed',
        idempotencyKey: `burst:${i}`,
        recipientUserId: userId,
        actorUserId: null,
        occurredAt,
        payload: { ingestId: INGEST },
      },
      STALE_AFTER_SECONDS,
    );
  }

  const policy = { claimBatch: 500, leaseSeconds, maxClaims: 20, concurrency: 32 };
  const drainStart = performance.now();
  let materialized = 0;
  while (materialized < opts.restartAfter) {
    const n = await runMaterializerOnce(repo, policy, { batchRpc: true });
    if (n === 0) break;
    materialized += n;
  }
  const restartedAfter = materialized;
  const interrupted = await repo.claimOutbox(policy.claimBatch, policy.leaseSeconds, policy.maxClaims);
  const finished = Math.floor(interrupted.length / 2);
  for (let i = 0; i < finished; i += 1) {
    const event = interrupted[i]!;
    await repo.materialize(event.outboxId, event.leaseToken, buildMaterializeRender(event));
  }
  materialized += finished;
  clock += (leaseSeconds + 1) * 1000 + 3_600_000;
  while (true) {
    const n = await runMaterializerOnce(repo, policy, { batchRpc: true });
    if (n === 0) break;
    materialized += n;
  }
  const drainMs = performance.now() - drainStart;

  const provider = new FakePushProvider();
  const message = (i: number): PushMessage => ({
    deliveryId: String(i),
    attemptNo: 1,
    token: 'ExponentPushToken[burst]',
    title: 'Burst',
    body: 'Load',
    data: { v: 1, nid: userId, did: String(i), type: 'ingest.failed', link: '/notifications' },
    ttlSeconds: 60,
    priority: 'default',
    collapseId: String(i),
    threadId: 'burst',
  });
  let fakePushBatches = 0;
  for (let i = 0; i < opts.count; i += provider.maxBatchSize) {
    await provider.send(Array.from({ length: Math.min(provider.maxBatchSize, opts.count - i) }, (_, j) => message(i + j)));
    fakePushBatches += 1;
  }

  clock += 8 * 86_400_000;
  const pruneStart = performance.now();
  await runPruneOnce(repo, 200);
  const pruneMs = performance.now() - pruneStart;

  return {
    enqueued: opts.count,
    materialized,
    restartedAfter,
    fakePushBatches,
    fakePushMessages: provider.sent.reduce((n, b) => n + b.length, 0),
    pruneMs,
    drainMs,
    redisUsed: false,
  };
}
