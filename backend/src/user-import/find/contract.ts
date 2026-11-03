/** Wire contract shared with the current mobile app. No runtime dependencies. */
export type StashSyncState = 'pending' | 'complete' | 'failed';
export type FindOutcome = {
  version: 1;
  category: 'processing' | 'completed' | 'attention';
  result: 'found' | 'partial' | 'empty' | 'failed' | 'pending';
  products: 'running' | 'complete' | 'failed' | 'unknown';
  places: 'running' | 'complete' | 'failed' | 'unknown';
  foundProducts: number; foundPlaces: number; resolvedPlaces: number; unverifiedPlaces: number; savedProducts: number; savedPlaces: number;
  stashSync: StashSyncState | 'unavailable';
  canRetryExtraction: boolean; canRetrySaving: boolean;
  extractionActive: boolean; delayed: boolean; finishedAt: string | null;
};

/** Reject incompatible responses instead of fabricating completed or empty Finds. */
export function readFindOutcome(value: unknown): FindOutcome {
  if (!value || typeof value !== 'object') throw new Error('Find outcome unavailable');
  const r = value as Record<string, unknown>;
  if (r.version !== 1 || !['processing','completed','attention'].includes(String(r.category))
    || !['found','partial','empty','failed','pending'].includes(String(r.result))
    || !['pending','complete','failed','unavailable'].includes(String(r.stashSync))
    || !['products','places'].every(k => ['running','complete','failed','unknown'].includes(String(r[k])))
    || !['foundProducts','foundPlaces','resolvedPlaces','unverifiedPlaces','savedProducts','savedPlaces'].every(k => Number.isSafeInteger(r[k]) && Number(r[k]) >= 0)
    || Number(r.resolvedPlaces)+Number(r.unverifiedPlaces)!==r.foundPlaces
    || !['canRetryExtraction','canRetrySaving','extractionActive','delayed'].every(k => typeof r[k] === 'boolean')
    || !(r.finishedAt === null || typeof r.finishedAt === 'string')) throw new Error('Incompatible Find outcome');
  return r as FindOutcome;
}

export type FindItem = { id: string; createdAt: string; sourceUrl: string | null; sourceType: 'instagram' | 'youtube' | 'web' | 'image';
  captureOrigin?: 'camera' | 'gallery' | null;
  privateMedia?: {state:'available';original:string;thumbnail:string} | null;
  contentSourceId: string | null; title: string | null; thumbnailUrl: string | null; outcome: FindOutcome;
  intent: { kind: 'product' | 'place' | 'both' | null; note: string | null; revision: number } };
export type FindCounts = { all: number; processing: number; completed: number; attention: number; saved: number };
export type FindProduct = { identityKey: string | null; id: string; title: string; imageUrl: string | null; catalogProductId: string | null; discoveredProductId: string | null;
  matchKind: 'exact' | 'similar' | 'unable_to_identify'; saved: boolean; removed: boolean };
export type FindPlace = { id: string; name: string; placeId: string | null; resolution: string; locality: string | null; city: string | null; saved: boolean; removed: boolean };
export type FindSavedSuggestion = { sourceProductId: string; candidateKey: string; identityKey: string; title: string; imageUrl: string | null; matchKind: 'similar'; saved: boolean; removed: boolean };
export type FindDetail = FindItem & { savedSuggestions: FindSavedSuggestion[]; products: FindProduct[]; places: FindPlace[] };
export type FindPage = { items: FindItem[]; nextCursor: string | null; counts: FindCounts };
export type FindBatch = { items: FindItem[]; unavailableIds: string[] };


export function readFindCounts(value: unknown): FindCounts {
  if (!value || typeof value !== 'object') throw new Error('Find counts unavailable');
  const row = value as FindCounts;
  if (![row.all,row.processing,row.completed,row.attention,row.saved].every(n => Number.isSafeInteger(n) && n >= 0)
    || row.processing+row.completed+row.attention !== row.all || row.saved > row.all) throw new Error('Incompatible Find counts');
  return row;
}
