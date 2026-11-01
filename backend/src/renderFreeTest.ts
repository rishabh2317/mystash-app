/** Explicit $0 Render testing entrypoint. Never used by existing Mac services. */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { logger } from './logger';
import { registeredFreeTestWorkers } from './workers/freeTestBudget';
import { getBullmqCommandRedis } from './workers/redisConnection';

process.env.NODE_ENV = 'production';
process.env.MYSTASH_RENDER_FREE_TEST = 'true';
process.env.INGEST_WORKER_EMBEDDED = 'true';
process.env.REDIS_REQUIRED = 'true';
process.env.SEARCH_ENV = 'development';
process.env.SEARCH_INDEX_BACKEND = 'memory';
process.env.EMBEDDING_PROVIDER = 'local';
// Global database maintenance keeps its existing owner; never start competing schedulers.
for (const flag of ['ANALYTICS_MAINTENANCE_ENABLED', 'ANALYTICS_ROLLUPS_ENABLED',
  'ANALYTICS_ADMIN_ROLLUPS_ENABLED', 'ANALYTICS_INTEREST_WORKER_ENABLED', 'NOTIFICATIONS_PUSH_ENABLED']) {
  process.env[flag] = 'false';
}

function containerMemory(): number | null {
  for (const file of ['/sys/fs/cgroup/memory.current', '/sys/fs/cgroup/memory/memory.usage_in_bytes']) {
    try { const value = Number(readFileSync(file, 'utf8').trim()); if (Number.isFinite(value)) return value; } catch {}
  }
  return null;
}

async function main() {
  if (!process.env.REDIS_URL) throw new Error('Dedicated test REDIS_URL required; never use Mac Redis');
  if (process.env.RENDER !== 'true') throw new Error('Render free-test entrypoint is restricted to Render');
  const { httpServer } = await import('./index');
  let peakContainerBytes = 0, peakRssBytes = 0, closing = false;
  const sample = () => {
    const mem = process.memoryUsage(), current = containerMemory();
    peakRssBytes = Math.max(peakRssBytes, mem.rss);
    if (current !== null) peakContainerBytes = Math.max(peakContainerBytes, current);
  };
  const sampler = setInterval(sample, 500); sampler.unref(); sample();
  const report = () => logger.info({ rssBytes: process.memoryUsage().rss, peakRssBytes,
    containerBytes: containerMemory(), peakContainerBytes, limitBytes: 512 * 1024 ** 2,
    registeredWorkers: registeredFreeTestWorkers().map(worker => worker.name) }, 'render.free_test.memory');
  const reporter = setInterval(report, 10_000); reporter.unref();
  const shutdown = async (signal: string) => {
    if (closing) return; closing = true;
    clearInterval(sampler); clearInterval(reporter); report();
    httpServer.close();
    logger.info({ signal }, 'render.free_test.draining');
    const deadline = setTimeout(() => process.exit(1), 25_000);
    await Promise.allSettled(registeredFreeTestWorkers().map(worker => worker.close()));
    getBullmqCommandRedis().disconnect(); clearTimeout(deadline);
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  for (let i = 0; i < 100 && registeredFreeTestWorkers().length < 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const workers = registeredFreeTestWorkers();
  if (workers.length !== 5) { await shutdown('incomplete_worker_startup'); return; }
  await Promise.all(workers.map(worker => worker.waitUntilReady()));
  report(); logger.info('render.free_test.ready');
}

void main().catch(error => {
  logger.error({ message: error instanceof Error ? error.message : 'Startup failed' }, 'render.free_test.failed');
  process.exit(1);
});
