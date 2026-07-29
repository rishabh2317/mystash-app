import type { SupabaseClient } from '@supabase/supabase-js';
import { getProductIntelligenceConfig } from './config';
import {
  SupabaseCatalogRepository,
  SupabaseMatchHistoryWriter,
  SupabaseSearchCandidateCache,
} from './catalog/SupabaseCatalogRepository';
import { MerchantEnrichmentService } from './enrichment/MerchantEnrichmentService';
import { TavilyMerchantExtractor } from './enrichment/TavilyMerchantExtractor';
import {
  ProductResolver,
  SupabaseDraftUpdater,
  type BackgroundResolveEnqueuer,
} from './resolver/ProductResolver';
import type { ProductSearchProvider } from './interfaces/ProductSearchProvider';
import { GoogleCustomSearchProvider } from './search/GoogleCustomSearchProvider';
import { SerperSearchProvider } from './search/SerperSearchProvider';
import { TavilyEnrichedPdpSearchStrategy } from './search/TavilyEnrichedPdpSearchStrategy';

export type ProductIntelligenceBundle = {
  resolver: ProductResolver;
  enrichment: MerchantEnrichmentService;
};

function createDiscoveryProvider(
  cfg: ReturnType<typeof getProductIntelligenceConfig>,
  cache: SupabaseSearchCandidateCache,
): ProductSearchProvider {
  if (cfg.searchProvider === 'google_cse') {
    return new GoogleCustomSearchProvider(
      cfg.googleCseApiKey ?? '',
      cfg.googleCseId ?? '',
      cache,
      cfg.searchCacheTtlMs,
    );
  }
  return new SerperSearchProvider(cfg.serperApiKey ?? '', cache, cfg.searchCacheTtlMs);
}

/** DI factory — no singletons. Discovery → rank → MerchantEnrichmentService (Tavily). */
export function createProductIntelligence(
  admin: SupabaseClient,
  ingestId: string,
  background: BackgroundResolveEnqueuer | null = null,
  traceId: string = ingestId,
): ProductIntelligenceBundle | null {
  const cfg = getProductIntelligenceConfig();
  if (!cfg.enabled) return null;

  const catalog = new SupabaseCatalogRepository(admin);
  const cache = new SupabaseSearchCandidateCache(admin);
  const discovery = createDiscoveryProvider(cfg, cache);
  const enrichment = new MerchantEnrichmentService(new TavilyMerchantExtractor(admin));
  const search = new TavilyEnrichedPdpSearchStrategy(
    discovery,
    enrichment,
    ingestId,
    traceId,
    cfg.metadataEnrichMaxCandidates,
  );
  const drafts = new SupabaseDraftUpdater(admin);
  const history = new SupabaseMatchHistoryWriter(admin);

  const resolver = new ProductResolver(
    catalog,
    search,
    drafts,
    history,
    cfg,
    cfg.backgroundResolve ? background : null,
    ingestId,
  );

  return { resolver, enrichment };
}
