import type { PlaceSearchAttempt } from './decidePlaceMention';

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
): Promise<PlaceSearchAttempt> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<PlaceSearchAttempt>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, reason: 'provider_failed' });
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      search.search(query, controller.signal).catch(() => ({
        ok: false as const,
        reason: 'provider_failed' as const,
      })),
      timedOut,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
