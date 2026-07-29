import type { SearchCandidate, SearchResult } from '../domain/types';
import type { MerchantEnrichmentService } from '../enrichment/MerchantEnrichmentService';
import type { ProductSearchProvider } from '../interfaces/ProductSearchProvider';
import type { SearchStrategy } from '../interfaces/ProductSearchProvider';
import { ingestLog } from '../../pipeline/ingestLog';
import { getPdpSearchHints } from './pdpSearchHints';
import { rankPdpCandidates } from './PdpRanker';
import { classifyPdp } from './PdpClassifier';

/**
 * Discovery (Serper) → PDP rank → MerchantEnrichmentService (Tavily).
 * ProductResolver stays dependent only on SearchStrategy / SearchCandidate.
 */
export class TavilyEnrichedPdpSearchStrategy implements SearchStrategy {
  constructor(
    private readonly discovery: ProductSearchProvider,
    private readonly enrichment: MerchantEnrichmentService,
    private readonly ingestId: string,
    private readonly traceId: string,
  ) {}

  async search(query: string): Promise<SearchResult> {
    const discovery = await this.discovery.search(query);
    if (discovery.kind === 'Failed') return discovery;

    const hints = getPdpSearchHints();
    if (!discovery.candidates.length) {
      return { kind: 'Succeeded', candidates: [], provider: this.discovery.name };
    }

    // Serper is discovery-only — never use search snippets/images as catalog metadata.
    const discoveryCandidates: SearchCandidate[] = discovery.candidates.map((c) => ({
      merchant: c.merchant,
      merchantUrl: c.merchantUrl,
      title: c.title,
      snippet: c.snippet,
      image: null,
      score: c.score,
    }));

    const ranked = rankPdpCandidates(discoveryCandidates, {
      brand: hints.brand,
      name: hints.name ?? query,
      category: hints.category,
    });

    if (!ranked.length) {
      ingestLog('info', 'search.pdp.rank_empty', {
        svc: 'product-intelligence',
        provider: this.discovery.name,
        candidateCount: discoveryCandidates.length,
      });
      return { kind: 'Succeeded', candidates: [], provider: this.discovery.name };
    }

    for (const best of ranked) {
      ingestLog('info', 'search.pdp.selected', {
        svc: 'product-intelligence',
        provider: this.discovery.name,
        pdpRankScore: best.pdpScore,
        merchantUrl: best.merchantUrl.slice(0, 160),
        brand: hints.brand ?? null,
        name: hints.name ?? null,
        category: hints.category ?? null,
        sourceTier: best.sourceTier ?? 'retailer',
      });

      const enriched = await this.enrichment.enrich({
        merchantUrl: best.merchantUrl,
        titleHint: hints.name ?? best.title,
        brandHint: hints.brand,
        categoryHint: hints.category,
        ingestId: this.ingestId,
        traceId: this.traceId,
      });
      if (enriched.kind === 'failed') {
        ingestLog('info', 'search.pdp.rejected', {
          svc: 'product-intelligence',
          merchantUrl: best.merchantUrl.slice(0, 160),
          reason: 'enrichment_failed',
        });
        continue;
      }

      const m = enriched.metadata;
      const classification = classifyPdp({
        url: m.merchantUrl,
        title: m.title,
        expectedBrand: hints.brand,
        metadata: {
          hasOffer: Boolean(m.price),
          price: m.price,
          productImage: m.primaryImage ?? m.image,
          specifications: m.specifications,
          merchantProductMetadata: m.metadataCompleteness >= 35,
        },
      });
      if (classification.verdict !== 'pdp') {
        ingestLog('info', 'search.pdp.rejected', {
          svc: 'product-intelligence',
          merchantUrl: best.merchantUrl.slice(0, 160),
          pdpClassifierScore: classification.score,
          reason: classification.reasons.join(','),
        });
        continue;
      }

      const candidate: SearchCandidate = {
        merchant: m.merchant,
        merchantUrl: m.merchantUrl,
        title: m.title,
        image: m.primaryImage ?? m.image,
        score: Math.min(1, Math.max(0.5, best.pdpScore / 100)),
        snippet: best.snippet,
        brand: m.brand,
        description: m.description,
        price: m.price,
        currency: m.currency,
        pdpScore: classification.score,
        pdpVerdict: classification.verdict,
        pdpReasons: classification.reasons,
        enrichmentSucceeded: true,
        sourceTier: classification.sourceTier,
        enrichmentMeta: {
          enrichmentProvider: m.provider,
          short_description: m.shortDescription,
          specifications: m.specifications,
          metadata_completeness: m.metadataCompleteness,
          price_source: m.priceSource,
          price_last_verified_at: m.priceLastVerifiedAt,
          primary_image: m.primaryImage,
          availability: m.availability,
          extracted_at: m.extractedAt,
          pdp_rank_score: best.pdpScore,
          pdp_classifier_score: classification.score,
          pdp_classifier_reasons: classification.reasons,
          source_tier: classification.sourceTier,
        },
      };
      return { kind: 'Succeeded', candidates: [candidate], provider: this.discovery.name };
    }

    return { kind: 'Succeeded', candidates: [], provider: this.discovery.name };
  }
}
