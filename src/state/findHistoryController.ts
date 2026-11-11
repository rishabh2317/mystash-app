import type { createFindClient, FindCounts, FindItem, FindSourceFilter } from '@/src/services/findClient';
import { findNeedsRefresh } from '@/src/services/findClient';
import { findHistoryMerge, type FindViewFilter } from '@/src/ui/find';

type Api = Pick<ReturnType<typeof createFindClient>, 'list' | 'batch' | 'refreshLoaded'>;
export type FindHistoryState = { owner: string | null; filter: FindViewFilter; source: FindSourceFilter; items: FindItem[]; counts: FindCounts | null;
  loaded: boolean; refreshing: boolean; loadingMore: boolean; cursor: string | null; error: string | null; moreError: string | null };
const empty = (owner: string | null, filter: FindViewFilter, source: FindSourceFilter = 'all'): FindHistoryState => ({ owner, filter, source, items: [], counts: null, loaded: false, refreshing: false, loadingMore: false, cursor: null, error: null, moreError: null });
/** One foreground reader. Cursor ownership and epochs fence filter, navigation and account races. */
export function createFindHistoryController(api: Api, timers: { schedule(fn: () => void, ms: number): unknown; cancel(handle: unknown): void }) {
  let state = empty(null, 'completed'), active = false, epoch = 0, revision = 0, busy = false, pageBusy = false, expanded = false;
  let timer: unknown = null;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<FindHistoryState>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  const clear = () => { if (timer !== null) timers.cancel(timer); timer = null; };
  const current = (token: number) => active && token === epoch && Boolean(state.owner);
  const arm = () => {
    clear();
    if (!active || !state.owner) return;
    const loadedWork = state.items.some(findNeedsRefresh), globalWork = (state.counts?.processing ?? 0)+(state.counts?.attention ?? 0)>0;
    if (loadedWork || globalWork || state.error) timer = timers.schedule(() => { timer = null; void refresh(false); }, loadedWork ? 5000 : 20000);
  };
  async function refresh(full = true) {
    if (!active || !state.owner || busy) return;
    busy = true; const token = epoch, owner = state.owner; revision++; pageBusy = false;
    clear(); publish({ refreshing: state.loaded, loadingMore: false });
    try {
      let updated = state.items, gone: string[] = [];
      if (updated.length && full) {
        const rows: FindItem[] = [];
        for (let offset = 0; offset < updated.length; offset += 100) {
          const result = await api.batch(updated.slice(offset, offset+100).map(item => item.id), owner);
          if (!current(token)) return;
          rows.push(...result.items); gone.push(...result.unavailableIds);
        }
        updated = rows;
      } else if (updated.length) updated = await api.refreshLoaded(updated, owner);
      if (!current(token)) return;
      const head = await api.list({ filter: state.filter, source: state.source, limit: 20 });
      if (!current(token)) return;
      if (head.ownerId !== owner) throw new Error('History owner changed');
      const items = expanded ? findHistoryMerge(updated, head.items, gone.filter(id => !head.items.some(item => item.id === id)), state.filter) : head.items;
      publish({ items, counts: head.counts, cursor: expanded ? state.cursor : head.nextCursor, loaded: true, error: null });
    } catch {
      if (current(token)) publish({ loaded: true, error: 'Couldn’t refresh your Finds. Check your connection and try again.' });
    } finally {
      if (current(token)) { busy = false; publish({ refreshing: false }); arm(); }
    }
  }
  return {
    getState: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    configure(owner: string | null, filter: FindViewFilter, source: FindSourceFilter = 'all') {
      if (state.owner === owner && state.filter === filter && state.source === source) return;
      // Counts cover every status for one owner/source, so a status switch does
      // not invalidate them. Never carry them across accounts or source scopes.
      const counts = owner && state.owner === owner && state.source === source ? state.counts : null;
      epoch++; revision++; clear(); busy = false; pageBusy = false; expanded = false;
      state = { ...empty(owner, filter, source), counts }; publish({});
      if (active) void refresh();
    },
    setActive(value: boolean) {
      if (active === value) return;
      active = value; epoch++; revision++; busy = false; pageBusy = false; clear();
      publish({ refreshing: false, loadingMore: false });
      if (active) void refresh();
    },
    refresh,
    async loadMore() {
      if (!active || !state.owner || !state.cursor || busy || pageBusy) return;
      const token = epoch, read = revision, cursor = state.cursor, owner = state.owner;
      pageBusy = true; publish({ loadingMore: true, moreError: null });
      try {
        const page = await api.list({ filter: state.filter, source: state.source, cursor, limit: 20 });
        if (!current(token) || read !== revision) return;
        if (page.ownerId !== owner) throw new Error('History owner changed');
        expanded = true;
        publish({ items: findHistoryMerge(state.items, page.items, [], state.filter), counts: page.counts, cursor: page.nextCursor });
      } catch { if (current(token) && read === revision) publish({ moreError: 'Couldn’t load more Finds. Your loaded history is still here.' }); }
      finally { if (current(token) && read === revision) { pageBusy = false; publish({ loadingMore: false }); arm(); } }
    },
  };
}
