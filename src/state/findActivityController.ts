import type { createFindClient, FindItem } from '../services/findClient';
import type { FindReceipt } from '../services/findActivityEvents';

type Api = Pick<ReturnType<typeof createFindClient>, 'list' | 'batch'>;
export type FindActivityState = { owner: string | null; item: FindItem | null };
const working = (item: FindItem) => item.outcome.extractionActive || item.outcome.stashSync === 'pending';

/** Follow the displayed Find through completion, independently of history filters. */
export function createFindActivityController(api: Api, timers: { schedule(fn: () => void, ms: number): unknown; cancel(handle: unknown): void }) {
  let state: FindActivityState = { owner: null, item: null }, active = false, epoch = 0, busy = false, again = false;
  let timer: unknown = null;
  const listeners = new Set<() => void>();
  const publish = (item: FindItem | null) => { state = { ...state, item }; listeners.forEach(fn => fn()); };
  const clear = () => { if (timer !== null) timers.cancel(timer); timer = null; };
  const current = (token: number) => active && token === epoch && Boolean(state.owner);
  async function refresh() {
    if (!active || !state.owner) return;
    if (busy) { again = true; return; }
    busy = true; clear();
    const token = epoch, owner = state.owner, displayed = state.item;
    try {
      // The head is read immediately, rather than behind refreshes of older rows.
      const [processing, attention, completed, tracked] = await Promise.all([
        api.list({ filter: 'processing', limit: 1 }),
        displayed ? Promise.resolve(null) : api.list({ filter: 'attention', limit: 1 }),
        displayed ? Promise.resolve(null) : api.list({ filter: 'completed', limit: 1 }),
        displayed ? api.batch([displayed.id], owner) : Promise.resolve(null),
      ]);
      if (!current(token) || [processing, attention, completed].some(page => page && page.ownerId !== owner)) return;
      // A receipt arriving during this read wins over its stale snapshot.
      if (state.item?.id !== displayed?.id) { again = true; return; }
      const retained = tracked?.items[0] ?? null;
      const newest = processing.items[0];
      // Older concurrent work must not replace the Find that just finished.
      const next = newest && (!retained || newest.id === retained.id || newest.createdAt > retained.createdAt)
        ? newest : retained ?? newest ?? attention?.items[0] ?? completed?.items[0] ?? null;
      publish(next);
    } catch {
      // Keep the last known state during a connection failure; never invent completion.
    } finally {
      if (current(token)) {
        busy = false;
        if (again) { again = false; void refresh(); }
        else timer = timers.schedule(() => { timer = null; void refresh(); }, state.item && working(state.item) ? 3000 : 20000);
      }
    }
  }
  return {
    getState: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    configure(owner: string | null) {
      if (owner === state.owner) return;
      epoch++; busy = false; again = false; clear(); state = { owner, item: null }; publish(null);
      if (active) void refresh();
    },
    setActive(value: boolean) {
      if (value === active) return;
      active = value; epoch++; busy = false; again = false; clear();
      if (active) void refresh();
    },
    received(receipt: FindReceipt) {
      if (receipt.owner !== state.owner) return;
      // Supersede a poll already in flight before applying this receipt.
      epoch++; busy = false; again = false; clear();
      const token = epoch;
      // Only a newly accepted import has a known initial state. Duplicate links
      // are fetched by ID so a completed Find never flashes as processing.
      if (receipt.created) {
        let sourceType: FindItem['sourceType'] = 'web';
        try { const host = new URL(receipt.sourceUrl).hostname; if (/(^|\.)instagram\.com$/.test(host)) sourceType = 'instagram'; else if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) sourceType = 'youtube'; } catch { /* Shared text may contain the URL. */ }
        publish({ id: receipt.id, createdAt: new Date().toISOString(), sourceUrl: null, sourceType, title: 'Link received', thumbnailUrl: null, contentSourceId: null,
          intent: { kind: null, note: null, revision: 0 },
          outcome: { version: 1, category: 'processing', result: 'pending', products: 'running', places: 'running', foundProducts: 0, foundPlaces: 0, resolvedPlaces: 0, unverifiedPlaces: 0, savedProducts: 0, savedPlaces: 0, stashSync: 'pending', canRetryExtraction: false, canRetrySaving: false, extractionActive: true, delayed: false, finishedAt: null } });
        void refresh();
      } else {
        void api.batch([receipt.id], receipt.owner).then(result => {
          if (!current(token)) return;
          if (result.items[0]) publish(result.items[0]);
          void refresh();
        }).catch(() => { if (current(token)) void refresh(); });
      }
    },
    refresh,
  };
}
