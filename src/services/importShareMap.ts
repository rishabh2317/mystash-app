export type ImportShareState = 'looking' | 'ready' | 'nothing_yet' | 'couldnt_finish';

export type ImportSharePrimaryProduct = {
  productId: string;
  title: string;
  imageUrl: string | null;
};

export type ImportResultStatus = 'running' | 'complete' | 'failed' | 'unknown';

export type ImportShare = {
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

function asShareState(value: unknown): ImportShareState | null {
  if (
    value === 'looking' ||
    value === 'ready' ||
    value === 'nothing_yet' ||
    value === 'couldnt_finish'
  ) {
    return value;
  }
  return null;
}

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

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function resultStatus(value: unknown): ImportResultStatus {
  return value === 'running' || value === 'complete' || value === 'failed' ? value : 'unknown';
}

export function hydrateImportShares(raw: unknown): ImportShare[] {
  if (!Array.isArray(raw)) return [];
  const shares: ImportShare[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const importId = typeof row.importId === 'string' ? row.importId : null;
    const state = asShareState(row.state);
    if (!importId || !state) continue;
    const createdAt = typeof row.createdAt === 'string' ? row.createdAt : '';
    const productCount =
      typeof row.productCount === 'number' && Number.isFinite(row.productCount)
        ? Math.max(0, Math.floor(row.productCount))
        : 0;
    const contentSourceId =
      typeof row.contentSourceId === 'string' && row.contentSourceId.trim()
        ? row.contentSourceId.trim()
        : null;
    const sourceUrl = typeof row.sourceUrl === 'string' ? row.sourceUrl.trim() : '';
    const products = asProducts(row.products);
    const primaryProduct = asPrimaryProduct(row.primaryProduct) ?? products[0] ?? null;
    const results = row.resultVersion === 1 ? {
      resultVersion: 1 as const,
      timedOut: row.timedOut === true,
      resultProductCount: count(row.resultProductCount),
      resultProducts: asProducts(row.resultProducts),
      placeCount: count(row.placeCount),
      resolvedPlaceCount: count(row.resolvedPlaceCount),
      unverifiedPlaceCount: count(row.unverifiedPlaceCount),
      productStatus: resultStatus(row.productStatus),
      placeStatus: resultStatus(row.placeStatus),
      hasInFlight: row.hasInFlight === true,
      canRetry: row.canRetry === true,
    } : {};
    shares.push({
      ...results,
      importId,
      state,
      kind: asShareKind(row.kind),
      createdAt,
      productCount,
      contentSourceId,
      sourceUrl,
      primaryProduct,
      products,
    });
  }
  return shares;
}
