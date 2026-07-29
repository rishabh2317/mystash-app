import type { SearchResult } from '../domain/types';
import type { ProductSearchProvider } from '../interfaces/ProductSearchProvider';
import type { SearchStrategy as ISearchStrategy } from '../interfaces/ProductSearchProvider';

/**
 * Orchestrates one or more ProductSearchProviders.
 * Phase 1: single Google CSE provider.
 * Resolver depends only on this strategy — never on Google types.
 */
export class DefaultSearchStrategy implements ISearchStrategy {
  constructor(private readonly providers: ProductSearchProvider[]) {
    if (!providers.length) throw new Error('SearchStrategy requires at least one provider');
  }

  async search(query: string): Promise<SearchResult> {
    let lastFail: SearchResult | null = null;
    for (const p of this.providers) {
      const result = await p.search(query);
      if (result.kind === 'Succeeded') return result;
      lastFail = result;
    }
    return (
      lastFail ?? {
        kind: 'Failed',
        errorKind: 'unknown',
        message: 'No search providers',
        provider: 'none',
      }
    );
  }
}
