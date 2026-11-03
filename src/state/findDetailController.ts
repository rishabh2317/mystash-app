import type { createFindClient, FindScreenDetail } from '@/src/services/findClient';
import { FindApiError, findNeedsRefresh } from '@/src/services/findClient';
type Api = Pick<ReturnType<typeof createFindClient>, 'detail'>;
export type FindDetailState = { owner: string | null; id: string; data: FindScreenDetail | null; loaded: boolean; refreshing: boolean; pending: string | null; error: string | null; actionError: string | null; notFound: boolean };
const empty = (owner: string | null, id: string): FindDetailState => ({ owner, id, data: null, loaded: false, refreshing: false, pending: null, error: null, actionError: null, notFound: false });
export function createFindDetailController(api: Api, timers: { schedule(fn: () => void, ms: number): unknown; cancel(handle: unknown): void }, onChanged: () => void = () => {}) {
  let state = empty(null,''), epoch = 0, active = false, busy = false, mutation = false, timer: unknown = null;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<FindDetailState>) => { state = { ...state,...patch }; listeners.forEach(fn => fn()); };
  const clear = () => { if (timer !== null) timers.cancel(timer); timer = null; };
  const current = (token: number) => active && token === epoch && Boolean(state.owner);
  const arm = () => { clear(); if (active && !mutation && ((state.data && findNeedsRefresh(state.data)) || (state.error && !state.notFound))) timer = timers.schedule(() => { timer = null; void refresh(); }, state.error ? 20000 : 5000); };
  async function refresh(notify = true) {
    if (!active || !state.owner || busy || mutation) return;
    if (!state.id) { publish({ loaded: true, notFound: true, error: 'This find is unavailable.' }); return; }
    busy = true; const token = epoch; clear(); publish({ refreshing: state.loaded });
    try {
      const data = await api.detail(state.id);
      if (current(token)) {
        const previous = state.data;
        publish({ data, loaded: true, error: null, notFound: false });
        if (notify && previous && (previous.outcome.savedProducts !== data.outcome.savedProducts || previous.outcome.savedPlaces !== data.outcome.savedPlaces)) onChanged();
      }
    } catch (error) {
      if (current(token)) publish({ loaded: true, ...(error instanceof FindApiError && error.status === 404 ? { data: null, notFound: true } : {}),
        error: error instanceof FindApiError && error.status === 404 ? 'This find is no longer available.' : 'Couldn’t refresh this find. Check your connection and try again.' });
    } finally { if (current(token)) { busy = false; publish({ refreshing: false }); arm(); } }
  }
  return {
    getState: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    configure(owner: string | null, id: string) {
      if (owner === state.owner && id === state.id) return;
      epoch++; clear(); busy = false; mutation = false; state = empty(owner,id); publish({}); if (active) void refresh();
    },
    setActive(value: boolean) {
      if (active === value) return;
      active = value; epoch++; clear(); busy = false; mutation = false; publish({ pending: null, refreshing: false }); if (active) void refresh();
    },
    refresh,
    async run(key: string, operation: () => Promise<unknown>): Promise<boolean> {
      if (!active || !state.owner || !state.data || mutation) return false;
      epoch++; const token = epoch; busy = false; mutation = true; clear(); publish({ pending: key, actionError: null });
      let success = false;
      try { await operation(); success = true; }
      catch (error) { if (current(token)) publish({ actionError: error instanceof FindApiError && error.status === 409 ? 'This result changed. Refresh and try again.' : 'Couldn’t confirm that change. Refresh to check its current status.' }); }
      finally {
        if (current(token)) { mutation = false; publish({ pending: null }); await refresh(false); if (success && current(token)) onChanged(); }
      }
      return success && current(token);
    },
  };
}
