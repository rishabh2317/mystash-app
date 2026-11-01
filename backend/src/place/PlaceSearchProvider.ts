import type { PlaceSearchAttempt } from './decidePlaceMention';
import { abortImportOperation } from '../user-import/workContext';

/** Separate from ProductSearchProvider. Place queries must not go through PDP search. */
export type PlaceSearchProvider = {
  readonly name: string;
  search(query: string, signal?: AbortSignal): Promise<PlaceSearchAttempt>;
};

export const PLACE_SEARCH_CANDIDATE_CAP = 5;
export const DEFAULT_PLACE_SEARCH_TIMEOUT_MS = 8000;

/**
 * Bounds one place search. Timeout and thrown errors become provider_failed.
 * The caller keeps the extracted lead and does not insert a canonical place.
 */
export async function searchPlacesWithTimeout(
  search: PlaceSearchProvider,
  query: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<PlaceSearchAttempt> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<PlaceSearchAttempt>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, reason: 'provider_failed' });
    }, timeoutMs);
  });
  try {
    return await abortImportOperation(Promise.race([
      search.search(query, signal ? AbortSignal.any([signal, controller.signal]) : controller.signal).catch(() => ({
        ok: false as const,
        reason: 'provider_failed' as const,
      })),
      timedOut,
    ]), signal);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
