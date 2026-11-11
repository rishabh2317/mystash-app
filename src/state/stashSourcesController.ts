import type { FindSourceSummary, FindSourceSummaryPage } from '@/src/services/findClient';

type Kind = 'product' | 'place';
type Stream = { rows: FindSourceSummary[]; cursor: string | null; started: boolean; done: boolean };
type Streams = Record<Kind, Stream>;
const streams = (): Streams => ({ product: { rows: [], cursor: null, started: false, done: false },
  place: { rows: [], cursor: null, started: false, done: false } });
export type StashSourcesState = { owner: string | null; items: FindSourceSummary[]; loaded: boolean;
  loading: boolean; more: boolean; hasMore: boolean; error: boolean };
const empty = (owner: string | null): StashSourcesState => ({ owner, items: [], loaded: false,
  loading: false, more: false, hasMore: false, error: false });

/** Merge the two existing server-keyset streams. Fetch both heads before choosing
 * a source, consume duplicate heads together, and retain unused rows for the next page. */
export function createStashSourcesController(fetchPage: (kind: Kind, cursor: string | null, owner: string) => Promise<FindSourceSummaryPage>) {
  let state = empty(null), pages = streams(), epoch = 0, busy = false, active = false;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<StashSourcesState>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  async function load(append: boolean) {
    if (!active || !state.owner || busy || append && !state.hasMore) return;
    busy = true; const token = ++epoch, owner = state.owner;
    const current = () => token === epoch && active && state.owner === owner;
    const working = append ? { product: { ...pages.product, rows: [...pages.product.rows] },
      place: { ...pages.place, rows: [...pages.place.rows] } } : streams();
    publish({ loading: !append, more: append, error: false });
    try {
      const rows: FindSourceSummary[] = [], seen = new Set(append ? state.items.map(item => item.id) : []);
      async function fill(kind: Kind) {
        const stream = working[kind]; let emptyPages = 0;
        while (!stream.rows.length && !stream.done) {
          const page = await fetchPage(kind, stream.started ? stream.cursor : null, owner);
          if (!current()) return;
          if (stream.started && page.nextCursor !== null && page.nextCursor === stream.cursor) throw Error('Source cursor did not advance');
          stream.rows = [...page.items]; stream.cursor = page.nextCursor; stream.done = page.nextCursor === null; stream.started = true;
          if (++emptyPages > 20) throw Error('Too many empty source pages');
        }
      }
      while (rows.length < 20) {
        await Promise.all([fill('product'), fill('place')]);
        if (!current()) return;
        const a = working.product.rows[0], b = working.place.rows[0];
        if (!a && !b) break;
        const row = !a ? b : !b ? a : Date.parse(a.createdAt) > Date.parse(b.createdAt)
          || Date.parse(a.createdAt) === Date.parse(b.createdAt) && a.id > b.id ? a : b;
        if (!row) break;
        if (a?.id === row.id) working.product.rows.shift();
        if (b?.id === row.id) working.place.rows.shift();
        if (!seen.has(row.id)) { seen.add(row.id); rows.push(row); }
      }
      if (!current()) return;
      pages = working;
      publish({ items: append ? [...state.items, ...rows] : rows, loaded: true,
        hasMore: Object.values(pages).some(stream => stream.rows.length > 0 || !stream.done) });
    } catch { if (current()) publish({ error: true, loaded: true }); }
    finally { if (current()) { busy = false; publish({ loading: false, more: false }); } }
  }
  return {
    getState: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    configure(owner: string | null) {
      if (state.owner === owner) return;
      epoch++; busy = false; pages = streams(); state = empty(owner); publish({});
    },
    setActive(value: boolean) {
      if (active === value) return;
      active = value; epoch++; busy = false; publish({ loading: false, more: false });
    },
    refresh: () => load(false),
    loadMore: () => load(true),
  };
}
