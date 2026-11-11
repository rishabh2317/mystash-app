import {CountryOfferService} from '../shopping/CountryOfferService';
import {createCountryOfferCache} from '../shopping/CountryOfferCache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { privateImageContext,imageSafeSearchCache } from '../user-import/media/privacy';
import type { SearchCandidateCache } from './interfaces/CatalogRepository';
import { getProductIntelligenceConfig } from './config';
import {
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
import { createCatalogService } from '../catalog/factory';
import type { CollectionTagRemapPort } from '../catalog/ports';
import { noopCollectionTagRemap } from '../catalog/ports';

export type ProductIntelligenceBundle = {
  countryOffers: CountryOfferService;
  search: import('./interfaces/ProductSearchProvider').SearchStrategy;
  resolver: ProductResolver;
  enrichment: MerchantEnrichmentService;
  catalog: ReturnType<typeof createCatalogService>;
};

function createDiscoveryProvider(
  cfg: ReturnType<typeof getProductIntelligenceConfig>,
  cache: SearchCandidateCache,
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
  tagRemap: CollectionTagRemapPort = noopCollectionTagRemap,
): ProductIntelligenceBundle | null {
  const cfg = getProductIntelligenceConfig();
  if (!cfg.enabled) return null;

  const catalog = createCatalogService(admin, tagRemap);
  const persistentCache = new SupabaseSearchCandidateCache(admin);
  const cache = imageSafeSearchCache(persistentCache);
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

  const countryOffers = new CountryOfferService(createCountryOfferCache(admin),
    (query,country)=>search.discoverMerchantEvidence(query,country));
  const resolver = new ProductResolver(
    catalog,
    search,
    { updateResolution: input => privateImageContext.getStore() ? Promise.resolve() : drafts.updateResolution(input) },
    { write: input => privateImageContext.getStore() ? Promise.resolve() : history.write(input) },
    cfg,
    cfg.backgroundResolve ? background : null,
    ingestId,
    countryOffers,
  );

  return { resolver, enrichment, catalog, search, countryOffers };
}
