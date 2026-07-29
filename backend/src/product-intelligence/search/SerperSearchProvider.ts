import { ingestLog } from '../../pipeline/ingestLog';
import type { SearchCandidate, SearchResult } from '../domain/types';
import type { SearchCandidateCache } from '../interfaces/CatalogRepository';
import type { ProductSearchProvider } from '../interfaces/ProductSearchProvider';
import { classifyHttpError, classifyNetworkError, hostLooksLikePdp } from './searchUtils';

const SERPER_SEARCH_URL = 'https://google.serper.dev/search';
const DEFAULT_NUM = 8;

type SerperOrganicItem = {
  title?: string;
  link?: string;
  snippet?: string;
  position?: number;
  imageUrl?: string;
  thumbnailUrl?: string;
};

type SerperSearchBody = {
  organic?: SerperOrganicItem[];
};

/**
 * Serper Google Search provider for Product Intelligence.
 * Drop-in ProductSearchProvider — maps organic hits to SearchCandidate only.
 */
export class SerperSearchProvider implements ProductSearchProvider {
  readonly name = 'serper';

  constructor(
    private readonly apiKey: string,
    private readonly cache?: SearchCandidateCache,
    private readonly ttlMs = 168 * 3600_000,
    private readonly num = DEFAULT_NUM,
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
        ingestLog('info', 'search.provider.cache_hit', {
          svc: 'product-intelligence',
          provider: this.name,
          queryLen: q.length,
          candidateCount: cached.length,
        });
        return { kind: 'Succeeded', candidates: cached, provider: this.name };
      }
    }

    if (!this.apiKey) {
      ingestLog('warn', 'search.provider.failed', {
        svc: 'product-intelligence',
        provider: this.name,
        errorKind: 'auth',
        message: 'SERPER_API_KEY not configured',
      });
      return {
        kind: 'Failed',
        errorKind: 'auth',
        message: 'SERPER_API_KEY not configured',
        provider: this.name,
      };
    }

    ingestLog('info', 'search.provider.request', {
      svc: 'product-intelligence',
      provider: this.name,
      queryLen: q.length,
      num: this.num,
    });

    let res: Response;
    try {
      res = await this.fetchImpl(SERPER_SEARCH_URL, {
        method: 'POST',
        headers: {
          'X-API-KEY': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: query.trim(), num: this.num }),
        signal: AbortSignal.timeout(12_000),
      });
    } catch (e) {
      const msg = (e as Error).message || 'network';
      const errorKind = classifyNetworkError(msg);
      ingestLog('warn', 'search.provider.failed', {
        svc: 'product-intelligence',
        provider: this.name,
        errorKind,
        message: msg.slice(0, 200),
      });
      return { kind: 'Failed', errorKind, message: msg.slice(0, 200), provider: this.name };
    }

    if (!res.ok) {
      const errorKind = classifyHttpError(res.status);
      const message = `Serper HTTP ${res.status}`;
      ingestLog('warn', 'search.provider.failed', {
        svc: 'product-intelligence',
        provider: this.name,
        errorKind,
        httpStatus: res.status,
        message,
      });
      return { kind: 'Failed', errorKind, message, provider: this.name };
    }

    let body: SerperSearchBody;
    try {
      body = (await res.json()) as SerperSearchBody;
    } catch {
      ingestLog('warn', 'search.provider.failed', {
        svc: 'product-intelligence',
        provider: this.name,
        errorKind: 'unknown',
        message: 'Serper JSON parse failed',
      });
      return {
        kind: 'Failed',
        errorKind: 'unknown',
        message: 'Serper JSON parse failed',
        provider: this.name,
      };
    }

    const organic = body.organic ?? [];
    const candidates: SearchCandidate[] = [];
    let filteredOut = 0;
    for (const item of organic) {
      const link = item.link?.trim();
      if (!link || !hostLooksLikePdp(link, item.title, item.snippet)) {
        filteredOut += 1;
        continue;
      }
      let merchant: string | null = null;
      try {
        merchant = new URL(link).hostname.replace(/^www\./, '');
      } catch {
        merchant = null;
      }
      const position = typeof item.position === 'number' ? item.position : candidates.length + 1;
      candidates.push({
        merchant,
        merchantUrl: link,
        title: (item.title ?? '').trim() || merchant || 'Product',
        snippet: item.snippet?.trim() || null,
        image: null,
        score: Math.max(0.45, 0.85 - (position - 1) * 0.05),
      });
    }

    if (this.cache) {
      await this.cache.set(q, this.name, candidates, this.ttlMs);
    }

    ingestLog('info', 'search.provider.succeeded', {
      svc: 'product-intelligence',
      provider: this.name,
      organicCount: organic.length,
      candidateCount: candidates.length,
      filteredOut,
    });

    return { kind: 'Succeeded', candidates, provider: this.name };
  }
}
