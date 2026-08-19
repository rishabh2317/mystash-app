import type { SearchCandidate, SearchResult } from '../domain/types';
import type { MerchantEnrichmentService } from '../enrichment/MerchantEnrichmentService';
import { validPriceValue } from '../enrichment/MetadataMergeService';
import type { ProductSearchProvider } from '../interfaces/ProductSearchProvider';
import type { SearchStrategy, SearchStrategyHints } from '../interfaces/ProductSearchProvider';
import { ingestLog } from '../../pipeline/ingestLog';
import { getPdpSearchHints } from './pdpSearchHints';
import { classifyPdp } from './PdpClassifier';
import { shortlistPdpCandidates } from './CandidateShortlister';
import { scoreCandidateDecisions } from '../scoring/CandidateScoring';
import { classifyCandidatePage } from './CandidatePageClassifier';
import { isStrongDirectUrlCandidate, merchantUrlsMatch } from './directUrlIdentity';

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

  async search(query: string, hints?: SearchStrategyHints): Promise<SearchResult> {
    const seed = hints?.seedMerchantUrl
      ? await this.enrichSeedUrl(hints.seedMerchantUrl)
      : null;

    if (hints?.skipDiscoveryIfSeedStrong && seed && isStrongDirectUrlCandidate(seed)) {
      ingestLog('info', 'search.direct_url.used', {
        svc: 'product-intelligence',
        merchantUrl: seed.merchantUrl.slice(0, 160),
        skippedDiscovery: true,
        pdpScore: seed.pdpScore,
      });
      return { kind: 'Succeeded', candidates: [seed], provider: 'direct_url' };
    }

    const discovery = await this.discovery.search(query);
    if (discovery.kind === 'Failed') {
      return seed
        ? { kind: 'Succeeded', candidates: [seed], provider: 'direct_url' }
        : discovery;
    }

    const pdpHints = getPdpSearchHints();
    if (!discovery.candidates.length) {
      return {
        kind: 'Succeeded',
        candidates: seed ? [seed] : [],
        provider: seed ? 'direct_url' : this.discovery.name,
      };
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
        brand: pdpHints.brand,
        name: pdpHints.name ?? query,
        category: pdpHints.category,
      },
      this.maxCandidates,
    );

    if (!shortlisted.length) {
      ingestLog('info', 'search.pdp.rank_empty', {
        svc: 'product-intelligence',
        provider: this.discovery.name,
        candidateCount: discoveryCandidates.length,
      });
      return {
        kind: 'Succeeded',
        candidates: seed ? [seed] : [],
        provider: this.discovery.name,
      };
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
        sourceType: best.sourceType,
        pageType: best.pageType,
        metadataCapable: best.capabilities.metadata,
        commerceCapable: best.capabilities.commerce,
        pdpRankScore: best.pdpScore,
      });

      const started = Date.now();
      const enriched = await this.enrichment.enrich({
        merchantUrl: best.merchantUrl,
        titleHint: pdpHints.name ?? best.title,
        brandHint: pdpHints.brand,
        categoryHint: pdpHints.category,
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
        expectedBrand: pdpHints.brand,
        metadata: {
          hasOffer: Boolean(validPrice),
          price: validPrice,
          productImage: m.primaryImage ?? m.image,
          specifications: m.specifications,
          merchantProductMetadata: m.metadataCompleteness >= 35,
        },
      });
      if (best.capabilities.commerce && classification.verdict !== 'pdp') {
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
        sourceType: best.sourceType,
        pageType: best.pageType,
        capabilities: best.capabilities,
        candidatePageType: best.candidatePageType,
        shoppingEligible: best.capabilities.commerce && classification.verdict === 'pdp',
        category: m.category,
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
        sourceType: best.sourceType,
        pageType: best.pageType,
        commerceCapable: best.capabilities.commerce,
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

    const merged = seed
      ? [
          seed,
          ...enrichedCandidates.filter((c) => !merchantUrlsMatch(c.merchantUrl, seed.merchantUrl)),
        ]
      : enrichedCandidates;

    return {
      kind: 'Succeeded',
      candidates: merged,
      provider: this.discovery.name,
    };
  }

  private async enrichSeedUrl(seedUrl: string): Promise<SearchCandidate | null> {
    const pdpHints = getPdpSearchHints();
    ingestLog('info', 'metadata.enrichment.started', {
      svc: 'product-intelligence',
      provider: 'direct_url',
      merchantUrl: seedUrl.slice(0, 160),
    });
    const started = Date.now();
    const enriched = await this.enrichment.enrich({
      merchantUrl: seedUrl,
      titleHint: pdpHints.name,
      brandHint: pdpHints.brand,
      categoryHint: pdpHints.category,
      ingestId: this.ingestId,
      traceId: this.traceId,
      acceptPartialCache: false,
    });
    if (enriched.kind === 'failed') {
      ingestLog('info', 'search.direct_url.weak', {
        svc: 'product-intelligence',
        merchantUrl: seedUrl.slice(0, 160),
        reason: 'enrichment_failed',
      });
      return null;
    }
    const m = enriched.metadata;
    const identityUrl = m.merchantUrl || seedUrl;
    const validPrice = validPriceValue(m.price, m.currency);
    const pdp = classifyPdp({
      url: identityUrl,
      title: m.title,
      expectedBrand: pdpHints.brand,
      metadata: {
        hasOffer: Boolean(validPrice),
        price: validPrice,
        productImage: m.primaryImage ?? m.image,
        specifications: m.specifications,
        merchantProductMetadata: m.metadataCompleteness >= 35,
      },
    });
    const page = classifyCandidatePage({
      url: identityUrl,
      title: m.title,
      expectedBrand: pdpHints.brand,
      sourceTier: pdp.sourceTier,
    });
    const candidate: SearchCandidate = {
      merchant: m.merchant,
      merchantUrl: identityUrl,
      title: m.title,
      image: m.primaryImage ?? m.image,
      score: 1,
      brand: m.brand,
      description: m.description,
      price: validPrice,
      currency: m.currency,
      pdpScore: pdp.score,
      pdpVerdict: pdp.verdict,
      pdpReasons: pdp.reasons,
      enrichmentSucceeded: true,
      sourceTier: pdp.sourceTier,
      sourceType: page.sourceType,
      pageType: page.pageType,
      capabilities: page.capabilities,
      shoppingEligible: page.capabilities.commerce && pdp.verdict === 'pdp',
      category: m.category,
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
        pdp_classifier_score: pdp.score,
        pdp_classifier_reasons: pdp.reasons,
        source_tier: pdp.sourceTier,
        identitySource: 'creator_supplied_url',
      },
    };
    const decisionScores = scoreCandidateDecisions(candidate);
    candidate.sourceAuthority = decisionScores.sourceAuthority;
    candidate.metadataScore = decisionScores.metadataScore;
    candidate.shoppingScore = decisionScores.shoppingScore;
    ingestLog('info', 'metadata.enrichment.completed', {
      svc: 'product-intelligence',
      merchantUrl: candidate.merchantUrl.slice(0, 160),
      sourceType: page.sourceType,
      pageType: page.pageType,
      commerceCapable: page.capabilities.commerce,
      pdpScore: candidate.pdpScore,
      metadataCompleteness: decisionScores.metadataCompleteness,
      durationMs: Date.now() - started,
      identitySource: 'creator_supplied_url',
    });
    return candidate;
  }
}
