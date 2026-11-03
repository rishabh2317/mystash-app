import type { FindOutcome } from '../../backend/src/user-import/find/contract';
export type ImportShareState = 'looking' | 'ready' | 'nothing_yet' | 'couldnt_finish';

export type ImportSharePrimaryProduct = {
  productId: string;
  title: string;
  imageUrl: string | null;
};

export type ImportResultStatus = 'running' | 'complete' | 'failed' | 'unknown';

export type ImportShare = {
  findOutcome: FindOutcome;
  resultVersion?: 1;
  timedOut?: boolean;
  resultProductCount?: number;
  resultProducts?: ImportSharePrimaryProduct[];
  placeCount?: number;
  resolvedPlaceCount?: number;
  unverifiedPlaceCount?: number;
  productStatus?: ImportResultStatus;
  placeStatus?: ImportResultStatus;
  hasInFlight?: boolean;
  canRetry?: boolean;
  importId: string;
  state: ImportShareState;
  kind: 'instagram' | 'youtube' | 'web';
  createdAt: string;
  productCount: number;
  contentSourceId: string | null;
  sourceUrl: string;
  primaryProduct: ImportSharePrimaryProduct | null;
  products: ImportSharePrimaryProduct[];
};

function asShareKind(value: unknown): ImportShare['kind'] {
  if (value === 'instagram' || value === 'youtube' || value === 'web') return value;
  return 'web';
}

function asPrimaryProduct(value: unknown): ImportSharePrimaryProduct | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const productId = typeof row.productId === 'string' ? row.productId.trim() : '';
  const title = typeof row.title === 'string' ? row.title.trim() : '';
  if (!productId || !title) return null;
  const imageUrl = typeof row.imageUrl === 'string' && row.imageUrl.trim() ? row.imageUrl.trim() : null;
  return { productId, title, imageUrl };
}

function asProducts(value: unknown): ImportSharePrimaryProduct[] {
  if (!Array.isArray(value)) return [];
  const out: ImportSharePrimaryProduct[] = [];
  for (const item of value) {
    const mapped = asPrimaryProduct(item);
    if (mapped) out.push(mapped);
  }
  return out;
}

function asOutcome(value: unknown): FindOutcome {
  if (!value || typeof value !== 'object') throw new Error('Find outcome unavailable. Update the app and backend together.');
  const r = value as Record<string, unknown>;
  if (r.version !== 1 || !['processing','completed','attention'].includes(String(r.category))
    || !['found','partial','empty','failed','pending'].includes(String(r.result))
    || !['pending','complete','failed','unavailable'].includes(String(r.stashSync))
    || !['products','places'].every(k => ['running','complete','failed','unknown'].includes(String(r[k])))
    || !['foundProducts','foundPlaces','resolvedPlaces','unverifiedPlaces','savedProducts','savedPlaces'].every(k => Number.isSafeInteger(r[k]) && Number(r[k]) >= 0)
    || !['canRetryExtraction','canRetrySaving','extractionActive','delayed'].every(k => typeof r[k] === 'boolean')
    || !(r.finishedAt === null || typeof r.finishedAt === 'string')) throw new Error('Incompatible Find outcome');
  return r as FindOutcome;
}

/** Current screens keep a small view model derived from the single outcome contract. */
function outcomeView(findOutcome: FindOutcome, products: ImportSharePrimaryProduct[]) {
  const hasInFlight = findOutcome.extractionActive || findOutcome.category === 'processing';
  const found = findOutcome.foundProducts + findOutcome.foundPlaces > 0;
  const state: ImportShareState = found ? 'ready' : hasInFlight ? 'looking' : findOutcome.result === 'empty' ? 'nothing_yet' : 'couldnt_finish';
  return { findOutcome, state, products, primaryProduct: products[0] ?? null, productCount: findOutcome.foundProducts,
    resultVersion: 1 as const, timedOut: findOutcome.delayed, resultProducts: products, resultProductCount: findOutcome.foundProducts,
    placeCount: findOutcome.foundPlaces, resolvedPlaceCount: findOutcome.resolvedPlaces, unverifiedPlaceCount: findOutcome.unverifiedPlaces, productStatus: findOutcome.products, placeStatus: findOutcome.places, hasInFlight,
    canRetry: findOutcome.canRetryExtraction || findOutcome.canRetrySaving };
}

export function hydrateImportShares(raw: unknown): ImportShare[] {
  if (!Array.isArray(raw)) return [];
  const shares: ImportShare[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const importId = typeof row.importId === 'string' ? row.importId : null;
    if (!importId) continue;
    const findOutcome = asOutcome(row.findOutcome);
    const createdAt = typeof row.createdAt === 'string' ? row.createdAt : '';
    const contentSourceId =
      typeof row.contentSourceId === 'string' && row.contentSourceId.trim()
        ? row.contentSourceId.trim()
        : null;
    const sourceUrl = typeof row.sourceUrl === 'string' ? row.sourceUrl.trim() : '';
    const products = asProducts(row.products);
    shares.push({
      ...outcomeView(findOutcome, products),
      importId,
      kind: asShareKind(row.kind),
      createdAt,
      contentSourceId,
      sourceUrl,
    });
  }
  return shares;
}
