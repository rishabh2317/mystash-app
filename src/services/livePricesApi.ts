import type { LivePriceResult, LivePricesResponse } from '@/src/types/livePrices';

export class LivePricesApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'LivePricesApiError';
  }
}

function apiBase(): string {
  const base = process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\/$/, '');
  if (!base) {
    throw new LivePricesApiError('Mystash product service is not configured.', 500);
  }
  return base;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hydrateResult(raw: unknown): LivePriceResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const offerId = asString(row.offerId);
  const merchantUrl = asString(row.merchantUrl);
  if (!offerId || !merchantUrl) return null;
  const source = row.source === 'live' || row.source === 'fallback' ? row.source : 'fallback';
  const status =
    row.status === 'success' ||
    row.status === 'unavailable' ||
    row.status === 'timeout' ||
    row.status === 'blocked' ||
    row.status === 'invalid'
      ? row.status
      : 'invalid';
  return {
    offerId,
    merchantName: asString(row.merchantName),
    merchantUrl,
    price: asString(row.price),
    currency: asString(row.currency),
    availability: asString(row.availability),
    fetchedAt: asString(row.fetchedAt),
    source,
    status,
  };
}

export function hydrateLivePrices(raw: unknown): LivePricesResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const productId = asString(row.productId);
  const country = asString(row.country);
  const fetchedAt = asString(row.fetchedAt);
  if (!productId || !country || !fetchedAt || !Array.isArray(row.results)) return null;
  const results: LivePriceResult[] = [];
  for (const item of row.results) {
    const next = hydrateResult(item);
    if (next) results.push(next);
  }
  return { productId, country, fetchedAt, results };
}

export async function fetchLivePrices(
  productId: string,
  attrs?: { country?: string | null; profileCountry?: string | null; locale?: string | null },
): Promise<LivePricesResponse> {
  const id = productId.trim();
  if (!id) throw new LivePricesApiError('Product id is required', 400);
  const query = new URLSearchParams();
  if (attrs?.country?.trim()) query.set('country', attrs.country.trim());
  if (attrs?.profileCountry?.trim()) query.set('profileCountry', attrs.profileCountry.trim());
  if (attrs?.locale?.trim()) query.set('locale', attrs.locale.trim());
  const suffix = query.toString();
  const res = await fetch(
    `${apiBase()}/products/${encodeURIComponent(id)}/live-prices${suffix ? `?${suffix}` : ''}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) {
    throw new LivePricesApiError(
      res.status === 404 ? 'Product not found' : `Live prices failed (${res.status})`,
      res.status,
    );
  }
  const payload = hydrateLivePrices(await res.json());
  if (!payload) throw new LivePricesApiError('Live price data was incomplete.', 500);
  return payload;
}
