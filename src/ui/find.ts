import type { FindItem, FindDetail } from '@/src/services/findClient';
export type FindViewFilter = 'all' | 'processing' | 'completed' | 'attention';
export const FIND_ROUTES = { home: '/(tabs)/find', history: '/(tabs)/find?filter=all', capture: '/(tabs)/find/capture', studio: '/(tabs)/create', profile: '/(tabs)/profile' } as const;
export const findDetailPath = (id: string) => `/find/${encodeURIComponent(id)}` as const;
export const FIND_COPY = { title: 'Your Finds', subtitle: 'Capture anything. Find what caught your eye.', recent: 'Recently Found',
  automatic: 'Products and places are saved to My Stash automatically.', capture: 'Paste URL', unavailable: 'Not available yet' } as const;
export function findMatchesFilter(item: FindItem, filter: FindViewFilter) { return filter === 'all' || item.outcome.category === filter; }
export function findSourceLabel(source: FindItem['sourceType']) { return source==='image'?'Your image':source === 'instagram' ? 'Instagram Reel' : source === 'youtube' ? 'YouTube Short' : 'Shared link'; }
export function findResultLabel(item: FindItem) {
  const o = item.outcome, parts = [o.foundProducts ? `${o.foundProducts} product${o.foundProducts === 1 ? '' : 's'}` : '', o.foundPlaces ? `${o.foundPlaces} place${o.foundPlaces === 1 ? '' : 's'}` : ''].filter(Boolean);
  return parts.length ? `${parts.join(' · ')} found` : o.extractionActive ? 'Finding products and places…' : o.result === 'empty' ? 'No products or places identified' : 'No identified results yet';
}
export function findStatus(item: FindItem): { label: string; message: string } {
  const o = item.outcome;
  if (o.delayed) return { label: 'Taking longer', message: 'This is taking longer than expected. You can leave and check back later.' };
  if (o.stashSync === 'failed') return { label: 'Saving needs attention', message: 'Your results are here, but automatic saving needs another try.' };
  if (o.extractionActive) return { label: 'Processing', message: 'Finding products and places in the background. Available results appear below.' };
  if (o.result === 'partial') return { label: 'Partial results', message: 'Some results were found. Part of this find could not finish.' };
  if (o.result === 'failed' || o.stashSync === 'unavailable') return { label: 'Needs Attention', message: 'We couldn’t finish this find. Any available results are still here.' };
  if (o.stashSync === 'pending') return { label: 'Saving to My Stash', message: 'Your results are ready. Finishing automatic saving…' };
  return { label: 'Completed', message: o.result === 'empty' ? 'We couldn’t identify products or places this time. The original link is still here.' : FIND_COPY.automatic };
}
export function safeFindUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try { const u = new URL(value); return ['https:','http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function findProductTarget(detail: FindDetail, id: string) {
  const product = detail.products.find(p => p.id === id);
  return product?.catalogProductId ?? product?.discoveredProductId ?? null;
}
export function findIdentityProductId(identity: string) { return /^[cd]:[0-9a-f-]{36}$/i.test(identity) ? identity.slice(2) : null; }
export function findHistoryMerge(existing: FindItem[], incoming: FindItem[], unavailable: string[], filter: FindViewFilter) {
  const gone = new Set(unavailable);
  return [...new Map([...existing,...incoming].map(item => [item.id,item])).values()]
    .filter(item => !gone.has(item.id) && findMatchesFilter(item, filter))
    .sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
