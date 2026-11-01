import type { PlaceSearchAttempt } from '../place/decidePlaceMention';
import { AsyncLocalStorage } from 'node:async_hooks';

export class StaleImportWorkError extends Error {
  constructor() { super('Import work no longer owns its lease'); this.name = 'StaleImportWorkError'; }
}
export class ImportWorkBusyError extends Error {
  constructor(readonly retryAfterMs = 60_000) { super('Import work already has an active owner'); }
}
export type ImportWorkContext = {
  sourceId: string;
  attemptId: string;
  signal: AbortSignal;
  owns?: () => boolean;
  placeSearches?: Map<string, Promise<PlaceSearchAttempt>>;
};
export const importWorkContext = new AsyncLocalStorage<ImportWorkContext>();

export function assertImportWorkActive(): void {
  const work = importWorkContext.getStore();
  if (!work) return;
  work.signal.throwIfAborted();
  if (work.owns && !work.owns()) throw new StaleImportWorkError();
}

/** Applied only to Supabase's admin transport. Ordinary API/Creator/Analytics calls
 * have no import context and keep their existing fetch behavior and headers. */
export const importWorkFetch: typeof fetch = async (input, init) => {
  const work = importWorkContext.getStore();
  if (!work) return fetch(input, init);
  assertImportWorkActive();
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set('x-mystash-import-source', work.sourceId);
  headers.set('x-mystash-import-attempt', work.attemptId);
  const signal = AbortSignal.any([work.signal, AbortSignal.timeout(25_000), ...(init?.signal ? [init.signal] : [])]);
  return fetch(input, { ...init, headers, signal });
};

/** Provider transport gets cancellation/deadlines, never private lease headers. */
export const importProviderFetch: typeof fetch = async (input, init) => {
  const work = importWorkContext.getStore();
  if (!work) return fetch(input, init);
  assertImportWorkActive();
  return fetch(input, { ...init, signal: AbortSignal.any([work.signal, AbortSignal.timeout(40_000),
    ...(init?.signal ? [init.signal] : [])]) });
};

/** Bound a legacy provider even if its SDK ignores cancellation. Its late writes
 * still carry the cancelled scope and are rejected by transport + database guards. */
export async function abortImportOperation<T>(operation: Promise<T>, signal = importWorkContext.getStore()?.signal): Promise<T> {
  if (!signal) return operation;
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new StaleImportWorkError());
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([operation, aborted]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

/** FIFO, bounded work; a rejection drains already-started tasks before returning. */
export async function mapImportConcurrent<T, R>(items: readonly T[], concurrency: number,
  task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  let failure: unknown;
  let failed = false;
  const workers = Array.from({ length: Math.min(items.length, Math.max(1, Math.floor(concurrency))) }, async () => {
    while (!failed && cursor < items.length) {
      const index = cursor++;
      try {
        assertImportWorkActive();
        results[index] = await task(items[index], index);
      } catch (err) { failure = err; failed = true; }
    }
  });
  await Promise.all(workers);
  if (failed) throw failure;
  return results;
}
