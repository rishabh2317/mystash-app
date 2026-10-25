export type ContentLoadState =
  | 'skeleton'
  | 'content'
  | 'empty'
  | 'error'
  | 'contentRefreshing'
  | 'contentPaginating';

export type ContentLoadInput = {
  /**
   * Detail screens: a successfully loaded page/profile exists.
   * Lists/grids: at least one item for the current resource identity.
   * False after an identity change that dropped stale content.
   */
  hasContent: boolean;
  fetching: boolean;
  fetchingMore?: boolean;
  error?: boolean;
};

/** Lists and grids: readiness is whether the current identity has items. */
export function hasListContent(itemCount: number): boolean {
  return itemCount > 0;
}

/** Detail screens: readiness is whether a page/profile for this identity loaded. */
export function hasDetailContent(ready: boolean): boolean {
  return ready;
}

/** Stable key for the currently requested resource (product, collection, query, user). */
export function resourceIdentity(...parts: (string | null | undefined)[]): string {
  return parts.map((part) => (typeof part === 'string' ? part.trim() : '')).join('|');
}

/**
 * Keep previously loaded content only when the request is for the same resource.
 * A new search query, product, or collection must not reuse the previous payload.
 */
export function retainLoadedContent(
  requestedIdentity: string | null | undefined,
  loadedIdentity: string | null | undefined,
): boolean {
  if (!requestedIdentity || !loadedIdentity) return false;
  return requestedIdentity === loadedIdentity;
}

/**
 * Resolve UI for a fetch. `fetchingMore` wins over generic `fetching` so
 * pagination does not masquerade as a full refresh.
 */
export function resolveContentLoadState(input: ContentLoadInput): ContentLoadState {
  const fetchingMore = Boolean(input.fetchingMore);
  const fetching = Boolean(input.fetching);
  const error = Boolean(input.error);

  if (input.hasContent) {
    if (fetchingMore) return 'contentPaginating';
    if (fetching) return 'contentRefreshing';
    return 'content';
  }

  if (error) return 'error';
  if (fetching || fetchingMore) return 'skeleton';
  return 'empty';
}

export function resolveListLoadState(input: {
  itemCount: number;
  fetching: boolean;
  fetchingMore?: boolean;
  error?: boolean;
}): ContentLoadState {
  return resolveContentLoadState({
    hasContent: hasListContent(input.itemCount),
    fetching: input.fetching,
    fetchingMore: input.fetchingMore,
    error: input.error,
  });
}
