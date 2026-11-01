import type Redis from 'ioredis';

export const INGESTION_QUEUES = ['ingest-pipeline', 'product-resolve', 'product-ai-review',
  'content-source-processing', 'creator-library-sync'] as const;
export type PendingJob = { queue: string; id: string; timestamp: number };
export type IngestionAdmission = {
  version: 1;
  approvedAt: string;
  /** Reviewed pre-existing jobs. Jobs submitted after approval are normal traffic. */
  existingJobs: { queue: string; id: string }[];
};

export function validateIngestionAdmission(value: unknown, now = Date.now()): IngestionAdmission {
  if (!value || typeof value !== 'object') throw new Error('Ingestion admission policy required');
  const p = value as IngestionAdmission;
  const at = Date.parse(p.approvedAt);
  if (p.version !== 1 || !Number.isFinite(at) || at > now || !Array.isArray(p.existingJobs)) {
    throw new Error('Invalid ingestion admission policy');
  }
  const identities = new Set<string>();
  for (const job of p.existingJobs) {
    if (!job || !(INGESTION_QUEUES as readonly string[]).includes(job.queue) ||
      typeof job.id !== 'string' || !job.id.trim()) throw new Error('Invalid reviewed job');
    const key = JSON.stringify([job.queue, job.id]);
    if (identities.has(key)) throw new Error('Duplicate reviewed job');
    identities.add(key);
  }
  return p;
}

export function assertPendingJobsApproved(jobs: PendingJob[], policy: IngestionAdmission): void {
  validateIngestionAdmission(policy);
  const approved = new Set(policy.existingJobs.map(j => JSON.stringify([j.queue, j.id])));
  const epoch = Date.parse(policy.approvedAt);
  for (const job of jobs) {
    if (!(INGESTION_QUEUES as readonly string[]).includes(job.queue) ||
      !Number.isFinite(job.timestamp) || job.timestamp <= 0 ||
      (!approved.has(JSON.stringify([job.queue, job.id])) && job.timestamp <= epoch)) {
      throw new Error('Unreviewed pending ingestion work; no workers started');
    }
  }
}

/** Reads only. Do not instantiate Queue: even its constructor can write metadata. */
export async function pendingIngestionJobs(redis: Pick<Redis, 'lrange' | 'zrange' | 'hget'>): Promise<PendingJob[]> {
  const jobs: PendingJob[] = [];
  for (const queue of INGESTION_QUEUES) {
    const prefix = `bull:${queue}`;
    const lists = await Promise.all(['wait', 'active', 'paused'].map(s => redis.lrange(`${prefix}:${s}`, 0, 500)));
    const sets = await Promise.all(['delayed', 'prioritized', 'waiting-children'].map(s => redis.zrange(`${prefix}:${s}`, 0, 500)));
    if ([...lists, ...sets].some(ids => ids.length > 500)) throw new Error('Too much pending work for automatic startup review');
    for (const id of new Set([...lists.flat(), ...sets.flat()])) {
      if (jobs.length >= 500) throw new Error('Too much pending work for automatic startup review');
      const timestamp = Number(await redis.hget(`${prefix}:${id}`, 'timestamp'));
      jobs.push({ queue, id, timestamp });
    }
  }
  return jobs;
}

export function hasIngestConsumer(clients: string): boolean {
  const prefix = `bull:${Buffer.from('ingest-pipeline').toString('base64')}`;
  return clients.split(/\r?\n/).some(line => {
    const name = line.split(' ').find(part => part.startsWith('name='))?.slice(5);
    return name === prefix || name?.startsWith(`${prefix}:w:`) === true;
  });
}

export function redisPersistenceHealthy(info: string): boolean {
  const values = Object.fromEntries(info.split(/\r?\n/).filter(l => l.includes(':')).map(l => l.split(':', 2)));
  return values.loading === '0' && values.rdb_last_bgsave_status === 'ok' &&
    (values.aof_enabled !== '1' || values.aof_last_write_status === 'ok');
}

export async function ingestionReadiness(deps: {
  ping(): Promise<string>; persistence(): Promise<string>; clients(): Promise<string>;
}, timeoutMs = 1000): Promise<{ ready: boolean; reason: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const [pong, info, clients] = await Promise.race([
      Promise.all([deps.ping(), deps.persistence(), deps.clients()]),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
    ]);
    if (pong !== 'PONG') return { ready: false, reason: 'redis_unavailable' };
    if (!redisPersistenceHealthy(info)) return { ready: false, reason: 'redis_persistence_unhealthy' };
    return hasIngestConsumer(clients) ? { ready: true, reason: 'ready' } : { ready: false, reason: 'worker_unavailable' };
  } catch {
    return { ready: false, reason: 'redis_unavailable' };
  } finally { if (timer) clearTimeout(timer); }
}

export function stoppedWorkers(workers: { name: string; isRunning(): boolean; isPaused(): boolean }[]): string[] {
  return workers.filter(w => !w.isRunning() && !w.isPaused()).map(w => w.name);
}
