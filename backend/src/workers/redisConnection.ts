import type { ConnectionOptions } from 'bullmq';
import { getPipelineConfig } from '../config/pipelineConfig';

/** Fail fast when Redis is down so HTTP can fall back to in-process pipeline. */
export function getBullmqConnection(): ConnectionOptions {
  const cfg = getPipelineConfig();
  return {
    url: cfg.redisUrl,
    // BullMQ requires null; enqueue uses withTimeout + enableOfflineQueue:false instead.
    maxRetriesPerRequest: null,
    connectTimeout: 3_000,
    enableOfflineQueue: false,
  };
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
