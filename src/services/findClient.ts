import type { ReviewProduct } from './shareReviewApi';
import { withRequestTimeout } from './requestTimeout';
import { readFindOutcome, readFindCounts, type FindItem, type FindPage, type FindBatch, type FindDetail, type FindCounts } from '../../backend/src/user-import/find/contract';
export type { FindItem, FindPage, FindBatch, FindDetail, FindCounts } from '../../backend/src/user-import/find/contract';

export type FindScreenDetail = FindDetail & { capabilities: { intent: boolean; suggestions: boolean } };

type Session = { userId: string; accessToken: string };
export type FindOwnedPage = FindPage & { ownerId: string };
export type FindFilter = 'all' | 'processing' | 'completed' | 'attention' | 'saved';
export class FindApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export function findNeedsRefresh(item: FindItem): boolean {
  return item.outcome.extractionActive || item.outcome.stashSync === 'pending' || item.outcome.stashSync === 'failed';
}
function readItem(row: FindItem): FindItem {
  if (!row || typeof row.id !== 'string' || typeof row.createdAt !== 'string') throw new FindApiError('Find response unavailable.', 503);
  return { ...row, outcome: readFindOutcome(row.outcome) };
}

/** Transport is injected for offline tests. One owner is retained across every batch refresh. */
export function createFindClient(deps: {
  baseURL: () => string | undefined;
  session: () => Promise<Session | null>;
  fetch: typeof fetch;
}) {
  async function owner(expected?: string): Promise<Session> {
    const current = await deps.session();
    if (!current || (expected && current.userId !== expected)) throw new FindApiError('Sign in to your original account to continue.', 401);
    return current;
  }
  async function request<T>(path: string, method = 'GET', body?: unknown, expectedOwner?: string): Promise<T> {
    const session = await owner(expectedOwner), base = deps.baseURL()?.replace(/\/$/, '');
    if (!base) throw new FindApiError('Mystash Find is not configured.', 503);
    const response = await withRequestTimeout(30_000, signal => deps.fetch(`${base}/finds${path}`, { method, signal,
      headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) }));
    await owner(session.userId);
    if (!response.ok) throw new FindApiError(response.status === 404 ? 'This find is no longer available.'
      : response.status === 409 ? 'This find changed. Refresh before trying again.' : 'Could not load or update this find. Please try again.', response.status);
    return response.json();
  }
  async function batch(ids: string[], expectedOwner?: string): Promise<FindBatch> {
    if (!ids.length) return { items: [], unavailableIds: [] };
    if (ids.length > 100) throw new FindApiError('Too many Finds in one refresh.', 400);
    const result = await request<FindBatch>('/batch', 'POST', { ids }, expectedOwner), requested = new Set(ids);
    if (!Array.isArray(result.items) || !Array.isArray(result.unavailableIds)
      || result.items.some(item => !requested.has(item.id)) || result.unavailableIds.some(id => !requested.has(id))) throw new FindApiError('Incompatible Find batch response.', 503);
    const returned = new Set(result.items.map(item => item.id)), unavailable = new Set(result.unavailableIds);
    if (returned.size !== result.items.length || unavailable.size !== result.unavailableIds.length
      || [...returned].some(id => unavailable.has(id)) || returned.size+unavailable.size !== requested.size) throw new FindApiError('Incomplete Find batch response.', 503);
    return { ...result, items: result.items.map(readItem) };
  }
  return {
    async list(options: { cursor?: string; limit?: number; filter?: FindFilter } = {}): Promise<FindOwnedPage> {
      const query = new URLSearchParams({ limit: String(options.limit ?? 20), filter: options.filter ?? 'all' });
      if (options.cursor) query.set('cursor', options.cursor);
      const session = await owner();
      const result = await request<FindPage>(`?${query}`, 'GET', undefined, session.userId);
      return { ...result, ownerId: session.userId, items: result.items.map(readItem), counts: readFindCounts(result.counts) };
    },
    counts: async () => readFindCounts(await request<FindCounts>('/counts')),
    async detail(id: string): Promise<FindScreenDetail> {
      const result = await request<FindScreenDetail>(`/${encodeURIComponent(id)}`);
      if (!result.capabilities || typeof result.capabilities.intent !== 'boolean' || typeof result.capabilities.suggestions !== 'boolean') throw new FindApiError('Find capabilities unavailable.', 503);
      return { ...result, ...readItem(result) };
    },
    batch,
    async refreshLoaded(items: FindItem[], expectedOwner: string): Promise<FindItem[]> {
      if (!expectedOwner) throw new FindApiError('A loaded history owner is required.', 401);
      const session = await owner(expectedOwner);
      const ids = [...new Set(items.filter(findNeedsRefresh).map(item => item.id))];
      if (!ids.length) return items;
      const updates = new Map<string, FindItem>(), unavailable = new Set<string>();
      for (let offset = 0; offset < ids.length; offset += 100) {
        const result = await batch(ids.slice(offset, offset + 100), session.userId);
        result.items.forEach(item => updates.set(item.id, item)); result.unavailableIds.forEach(id => unavailable.add(id));
      }
      await owner(session.userId);
      return items.filter(item => !unavailable.has(item.id)).map(item => updates.get(item.id) ?? item);
    },
    remove: (id: string) => request(`/${encodeURIComponent(id)}`, 'DELETE'),
    retry: (id: string, kind: 'extraction' | 'saving') => request(`/${encodeURIComponent(id)}/retry`, 'POST', { kind }),
    removeResult: (id: string, type: 'products' | 'places', resultId: string, expectedIdentity?: string) => request(`/${encodeURIComponent(id)}/${type}/${encodeURIComponent(resultId)}`, 'DELETE', type === 'products' ? { expectedIdentity } : undefined),
    restoreResult: (id: string, type: 'products' | 'places', resultId: string, expectedIdentity?: string) => request(`/${encodeURIComponent(id)}/${type}/${encodeURIComponent(resultId)}/restore`, 'POST', type === 'products' ? { expectedIdentity } : undefined),
    updateIntent: (id: string, intent: FindItem['intent']) => request(`/${encodeURIComponent(id)}/intent`, 'PATCH', { intent: { kind: intent.kind, note: intent.note }, expectedRevision: intent.revision }),
    suggestions: (id: string) => request<{ products: ReviewProduct[]; places: { id: string; name: string }[] }>(`/${encodeURIComponent(id)}/suggestions`),
    removeSavedSuggestion: (id: string, resultId: string, key: string, expectedIdentity: string) => request(`/${encodeURIComponent(id)}/suggestions/${encodeURIComponent(resultId)}/${encodeURIComponent(key)}`, 'DELETE', { expectedIdentity }),
    restoreSavedSuggestion: (id: string, resultId: string, key: string, expectedIdentity: string) => request(`/${encodeURIComponent(id)}/suggestions/${encodeURIComponent(resultId)}/${encodeURIComponent(key)}/restore`, 'POST', { expectedIdentity }),
    decideSuggestion: (id: string, sourceProductId: string, candidateKey: string, action: 'save' | 'dismiss') => request(`/${encodeURIComponent(id)}/suggestions`, 'POST', { sourceProductId, candidateKey, action }),
  };
}
