import type { SearchCandidate, SearchResult } from '../domain/types';
import type { ProductSearchProvider } from '../interfaces/ProductSearchProvider';
import type { SearchCandidateCache } from '../interfaces/CatalogRepository';
import { classifyHttpError, classifyNetworkError, hostLooksLikePdp } from './searchUtils';

type CseItem = {
  title?: string;
  link?: string;
  displayLink?: string;
  pagemap?: { cse_image?: Array<{ src?: string }> };
};

/**
 * Google Custom Search provider (optional DI / PRODUCT_SEARCH_PROVIDER=google_cse).
 * Maps HTTP results to provider-agnostic SearchCandidate only.
 */
export class GoogleCustomSearchProvider implements ProductSearchProvider {
  readonly name = 'google_cse';

  constructor(
    private readonly apiKey: string,
    private readonly cseId: string,
    private readonly cache?: SearchCandidateCache,
    private readonly ttlMs = 168 * 3600_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(query: string): Promise<SearchResult> {
    const q = query.trim().toLowerCase();
    if (!q) {
      return { kind: 'Succeeded', candidates: [], provider: this.name };
    }

    if (this.cache) {
      const cached = await this.cache.get(q, this.name);
      if (cached) {
        return { kind: 'Succeeded', candidates: cached, provider: this.name };
      }
    }

    if (!this.apiKey || !this.cseId) {
      return {
        kind: 'Failed',
        errorKind: 'auth',
        message: 'GOOGLE_CSE_API_KEY or GOOGLE_CSE_ID not configured',
        provider: this.name,
      };
    }

    const url =
      `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(this.apiKey)}` +
      `&cx=${encodeURIComponent(this.cseId)}&num=8&q=${encodeURIComponent(query)}`;

    let res: Response;
    try {
      res = await this.fetchImpl(url, { signal: AbortSignal.timeout(12_000) });
    } catch (e) {
      const msg = (e as Error).message || 'network';
      return {
        kind: 'Failed',
        errorKind: classifyNetworkError(msg),
        message: msg.slice(0, 200),
        provider: this.name,
      };
    }

    if (!res.ok) {
      return {
        kind: 'Failed',
        errorKind: classifyHttpError(res.status),
        message: `CSE HTTP ${res.status}`,
        provider: this.name,
      };
    }

    let body: { items?: CseItem[] };
    try {
      body = (await res.json()) as { items?: CseItem[] };
    } catch {
      return {
        kind: 'Failed',
        errorKind: 'unknown',
        message: 'CSE JSON parse failed',
        provider: this.name,
      };
    }

    const candidates: SearchCandidate[] = [];
    for (const item of body.items ?? []) {
      const link = item.link?.trim();
      if (!link || !hostLooksLikePdp(link)) continue;
      let merchant: string | null = item.displayLink ?? null;
      try {
        merchant = new URL(link).hostname.replace(/^www\./, '');
      } catch {
        /* keep displayLink */
      }
      const image = item.pagemap?.cse_image?.[0]?.src ?? null;
      candidates.push({
        merchant,
        merchantUrl: link,
        title: (item.title ?? '').trim() || merchant || 'Product',
        image,
        score: 0.7,
      });
    }

    if (this.cache) {
      await this.cache.set(q, this.name, candidates, this.ttlMs);
    }

    return { kind: 'Succeeded', candidates, provider: this.name };
  }
}
