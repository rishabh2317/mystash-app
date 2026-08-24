import net from 'node:net';
import Redis, { type RedisOptions } from 'ioredis';
import { getPipelineConfig } from '../config/pipelineConfig';
import { getEnv } from '../env';
import { logger } from '../logger';

/**
 * Local embedded MVP does not require Redis. BullMQ is best-effort; HTTP
 * in-process fallback is the supported path when 127.0.0.1:6379 is down.
 * Set REDIS_REQUIRED=true to treat Redis as mandatory (dedicated workers).
 */
export function isRedisRequired(): boolean {
  return getEnv('REDIS_REQUIRED')?.toLowerCase() === 'true';
}

export function isRedisOptional(): boolean {
  return !isRedisRequired();
}

/**
 * Parse REDIS_URL into explicit host/port so BullMQ extra connections
 * do not hang on IPv6 `localhost` or a duplicated `url` option.
 */
export function buildBullmqConnectionOptions(redisUrl: string): RedisOptions {
  const optional = isRedisOptional();
  const fallback: RedisOptions = {
    host: '127.0.0.1',
    port: 6379,
    family: 4,
    maxRetriesPerRequest: null,
    connectTimeout: 1_000,
    enableReadyCheck: true,
    enableOfflineQueue: false,
    lazyConnect: true,
    retryStrategy: optional
      ? () => null
      : (times: number) => Math.min(times * 200, 2_000),
  };

  try {
    const parsed = new URL(redisUrl);
    const host =
      !parsed.hostname || parsed.hostname === 'localhost' ? '127.0.0.1' : parsed.hostname;
    const port = parsed.port ? Number(parsed.port) : 6379;
    const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
    const username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
    const dbPath = parsed.pathname.replace(/^\//, '');
    const db = dbPath && Number.isFinite(Number(dbPath)) ? Number(dbPath) : undefined;
    const tls = parsed.protocol === 'rediss:' ? {} : undefined;

    return {
      ...fallback,
      host,
      port,
      ...(password ? { password } : {}),
      ...(username ? { username } : {}),
      ...(db != null ? { db } : {}),
      ...(tls ? { tls } : {}),
    };
  } catch {
    return fallback;
  }
}

export async function probeRedisTcp(
  host: string,
  port: number,
  timeoutMs = 200,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      finish(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

let commandRedis: Redis | null = null;
let redisAvailability: boolean | null = null;
let unavailableLogged = false;

export function resetRedisAvailabilityCache(): void {
  redisAvailability = null;
  unavailableLogged = false;
  if (commandRedis) {
    commandRedis.disconnect();
    commandRedis = null;
  }
}

export function setRedisAvailabilityForTests(available: boolean): void {
  redisAvailability = available;
}

function connectionTarget(): { host: string; port: number } {
  const opts = buildBullmqConnectionOptions(getPipelineConfig().redisUrl);
  return { host: String(opts.host ?? '127.0.0.1'), port: Number(opts.port ?? 6379) };
}

export async function resolveRedisAvailability(): Promise<boolean> {
  if (redisAvailability != null) return redisAvailability;
  const { host, port } = connectionTarget();
  const ok = await probeRedisTcp(host, port);
  redisAvailability = ok;
  if (!ok) {
    if (!unavailableLogged) {
      unavailableLogged = true;
      logger.warn(
        { host, port, optional: isRedisOptional() },
        'ingest.redis.unavailable',
      );
    }
  }
  return ok;
}

export function shouldBypassBullmqEnqueue(redisAvailable: boolean): boolean {
  return !redisAvailable && isRedisOptional();
}

function attachRedisStateLogs(redis: Redis, role: string): void {
  const fields = () => ({
    role,
    status: redis.status,
    host: redis.options.host,
    port: redis.options.port,
  });
  redis.on('connect', () => logger.info(fields(), 'ingest.redis.connect'));
  redis.on('ready', () => logger.info(fields(), 'ingest.redis.ready'));
  redis.on('error', (err) => {
    if (isRedisOptional() && /ECONNREFUSED/i.test(err.message)) {
      if (!unavailableLogged) {
        unavailableLogged = true;
        logger.warn({ ...fields(), err: err.message }, 'ingest.redis.unavailable');
      }
      return;
    }
    logger.warn({ ...fields(), err: err.message }, 'ingest.redis.error');
  });
  redis.on('close', () => {
    if (isRedisOptional()) return;
    logger.warn(fields(), 'ingest.redis.close');
  });
  redis.on('end', () => {
    if (isRedisOptional()) return;
    logger.warn(fields(), 'ingest.redis.end');
  });
}

/** Shared command client. Queue uses this instance; Worker must `.duplicate()`. */
export function getBullmqCommandRedis(): Redis {
  if (commandRedis) return commandRedis;
  const opts = buildBullmqConnectionOptions(getPipelineConfig().redisUrl);
  commandRedis = new Redis(opts);
  attachRedisStateLogs(commandRedis, 'command');
  logger.info(
    { status: commandRedis.status, host: opts.host, port: opts.port, optional: isRedisOptional() },
    'ingest.redis.command_client_created',
  );
  return commandRedis;
}

export type RedisEnqueueState = {
  status: string;
  host?: string;
  port?: number;
};

export function describeRedisEnqueueState(redis: Redis): RedisEnqueueState {
  return {
    status: redis.status,
    host: typeof redis.options.host === 'string' ? redis.options.host : undefined,
    port: redis.options.port,
  };
}

export function isCommandRedisReady(state: RedisEnqueueState): boolean {
  return state.status === 'ready';
}

export const REDIS_UNAVAILABLE_ENQUEUE_ERROR = 'ingest.queue.redis_unavailable';

/** BullMQ Queue/Worker connection: a live ioredis command client. */
export function getBullmqConnection(): Redis {
  return getBullmqCommandRedis();
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
