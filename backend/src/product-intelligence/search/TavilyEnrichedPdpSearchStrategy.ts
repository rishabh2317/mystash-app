import type { SearchCandidate, SearchResult } from '../domain/types';
import type { MerchantEnrichmentService } from '../enrichment/MerchantEnrichmentService';
import { validPriceValue } from '../enrichment/MetadataMergeService';
import type { ProductSearchProvider } from '../interfaces/ProductSearchProvider';
import type { SearchStrategy } from '../interfaces/ProductSearchProvider';
import { ingestLog } from '../../pipeline/ingestLog';
import { getPdpSearchHints } from './pdpSearchHints';
import { classifyPdp } from './PdpClassifier';
import { shortlistPdpCandidates } from './CandidateShortlister';
import { scoreCandidateDecisions } from '../scoring/CandidateScoring';

/**
 * Discovery (Serper) → shortlist many PDPs → enrich until fields fill → return all successes.
 * ProductResolver merges metadata and resolves shopping independently.
 */
export class TavilyEnrichedPdpSearchStrategy implements SearchStrategy {
  constructor(
    private readonly discovery: ProductSearchProvider,
    private readonly enrichment: MerchantEnrichmentService,
    private readonly ingestId: string,
    private readonly traceId: string,
    private readonly maxCandidates: number = 5,
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

    const shortlisted = shortlistPdpCandidates(
      discoveryCandidates,
      {
        brand: hints.brand,
        name: hints.name ?? query,
        category: hints.category,
      },
      this.maxCandidates,
    );

    if (!shortlisted.length) {
      ingestLog('info', 'search.pdp.rank_empty', {
        svc: 'product-intelligence',
        provider: this.discovery.name,
        candidateCount: discoveryCandidates.length,
      });
      return { kind: 'Succeeded', candidates: [], provider: this.discovery.name };
    }

    // Candidates are independent. Promise.all is bounded by the configured
    // shortlist size (max 10) and preserves shortlist order in the result.
    const enrichmentResults = await Promise.all(
      shortlisted.map(async (best): Promise<SearchCandidate | null> => {
      ingestLog('info', 'metadata.enrichment.started', {
        svc: 'product-intelligence',
        provider: this.discovery.name,
        merchantUrl: best.merchantUrl.slice(0, 160),
        sourceTier: best.sourceTier,
        candidatePageType: best.candidatePageType,
        shoppingEligible: best.shoppingEligible,
        pdpRankScore: best.pdpScore,
      });

      const started = Date.now();
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
        return null;
      }

      const m = enriched.metadata;
      const validPrice = validPriceValue(m.price, m.currency);
      if (m.price && !validPrice) {
        ingestLog('warn', 'metadata.price.rejected', {
          svc: 'product-intelligence',
          merchantUrl: best.merchantUrl.slice(0, 160),
          rejectedValue: m.price.slice(0, 80),
        });
      }
      const classification = classifyPdp({
        url: m.merchantUrl,
        title: m.title,
        expectedBrand: hints.brand,
        metadata: {
          hasOffer: Boolean(validPrice),
          price: validPrice,
          productImage: m.primaryImage ?? m.image,
          specifications: m.specifications,
          merchantProductMetadata: m.metadataCompleteness >= 35,
        },
      });
      if (best.shoppingEligible && classification.verdict !== 'pdp') {
        ingestLog('info', 'search.pdp.rejected', {
          svc: 'product-intelligence',
          merchantUrl: best.merchantUrl.slice(0, 160),
          pdpClassifierScore: classification.score,
          reason: classification.reasons.join(','),
        });
        return null;
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
        price: validPrice,
        currency: m.currency,
        pdpScore: classification.score,
        pdpVerdict: classification.verdict,
        pdpReasons: classification.reasons,
        enrichmentSucceeded: true,
        sourceTier: best.sourceTier,
        candidatePageType: best.candidatePageType,
        shoppingEligible: best.shoppingEligible && classification.verdict === 'pdp',
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
      const decisionScores = scoreCandidateDecisions(candidate);
      candidate.sourceAuthority = decisionScores.sourceAuthority;
      candidate.metadataScore = decisionScores.metadataScore;
      candidate.shoppingScore = decisionScores.shoppingScore;

      ingestLog('info', 'metadata.enrichment.completed', {
        svc: 'product-intelligence',
        merchantUrl: best.merchantUrl.slice(0, 160),
        sourceTier: best.sourceTier,
        candidatePageType: best.candidatePageType,
        shoppingEligible: candidate.shoppingEligible,
        sourceAuthority: decisionScores.sourceAuthority,
        metadataScore: decisionScores.metadataScore,
        shoppingScore: decisionScores.shoppingScore,
        pdpScore: candidate.pdpScore,
        metadataCompleteness: decisionScores.metadataCompleteness,
        durationMs: Date.now() - started,
      });
      return candidate;
      }),
    );

    const enrichedCandidates = enrichmentResults.filter(
      (candidate): candidate is SearchCandidate => candidate !== null,
    );

    return {
      kind: 'Succeeded',
      candidates: enrichedCandidates,
      provider: this.discovery.name,
    };
  }
}
