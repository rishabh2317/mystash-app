import type { SearchCandidate, SearchResult } from '../domain/types';
import type { MerchantEnrichmentService } from '../enrichment/MerchantEnrichmentService';
import { mergeEnrichedCandidates, validPriceValue } from '../enrichment/MetadataMergeService';
import type { ProductSearchProvider } from '../interfaces/ProductSearchProvider';
import type { SearchStrategy, SearchStrategyHints } from '../interfaces/ProductSearchProvider';
import { ingestLog } from '../../pipeline/ingestLog';
import { getPdpSearchHints } from './pdpSearchHints';
import { classifyPdp } from './PdpClassifier';
import { classifyCandidatePage } from './CandidatePageClassifier';
import { decoratePdpCandidates, shortlistPdpCandidates, type ShortlistedCandidate } from './CandidateShortlister';
import { scoreCandidateDecisions } from '../scoring/CandidateScoring';
import { isStrongDirectUrlCandidate, merchantUrlsMatch } from './directUrlIdentity';
import { isExactProductBuyingUrl } from '../../shopping/productUrlIdentity';
import {
  amazonPreferredSearchQuery,
  mergeSearchCandidates,
  officialPreferredSearchQuery,
  isAmazonPreferredMetadataCandidate,
  isOfficialPreferredMetadataCandidate,
  marketplacePreferredSearchQueries,
  pickPreferredMetadataTargets,
  shouldStopAfterPreferredMetadata,
  toDiscoveryCandidates,
} from './preferredMetadataTargets';

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
    const userImportExpansion = Boolean(hints?.enrichAllCommerce);
    const seed = hints?.seedMerchantUrl
      ? await this.enrichSeedUrl(hints.seedMerchantUrl)
      : null;
    const seedRetained = Boolean(seed);

    if (hints?.skipDiscoveryIfSeedStrong && seed && isStrongDirectUrlCandidate(seed)) {
      ingestLog('info', 'search.direct_url.used', {
        svc: 'product-intelligence',
        merchantUrl: seed.merchantUrl.slice(0, 160),
        skippedDiscovery: true,
        pdpScore: seed.pdpScore,
      });
      if (userImportExpansion) {
        // Should not happen for user-import (skipDiscoveryIfSeedStrong=false), but log clearly.
        ingestLog('info', 'merchant_discovery.skipped', {
          svc: 'product-intelligence',
          reason: 'strong_seed_skip_enabled',
          seedRetained: true,
          skippedDiscovery: true,
        });
      }
      return { kind: 'Succeeded', candidates: [seed], provider: 'direct_url' };
    }

    if (userImportExpansion) {
      ingestLog('info', 'merchant_discovery.started', {
        svc: 'product-intelligence',
        skippedDiscovery: false,
        seedRetained,
        skipDiscoveryIfSeedStrong: Boolean(hints?.skipDiscoveryIfSeedStrong),
        maxAdditionalMerchantOffers: hints?.maxAdditionalMerchantOffers ?? null,
        lightweightAdditionalMerchants: Boolean(hints?.lightweightAdditionalMerchants),
        reason: seedRetained
          ? 'user_import_seed_plus_discovery'
          : 'user_import_discovery_without_seed',
      });
    }

    const discovery = await this.discovery.search(query);
    if (discovery.kind === 'Failed') {
      if (userImportExpansion) {
        ingestLog('info', 'merchant_discovery.completed', {
          svc: 'product-intelligence',
          candidate_count: 0,
          qualifying_count: seedRetained ? 1 : 0,
          seed_retained: seedRetained,
          duplicates_removed: 0,
          final_offer_count: seedRetained ? 1 : 0,
          discoveryFailed: true,
        });
      }
      return seed
        ? { kind: 'Succeeded', candidates: [seed], provider: 'direct_url' }
        : discovery;
    }

    const pdpHints = getPdpSearchHints();
    if (!discovery.candidates.length) {
      if (userImportExpansion) {
        ingestLog('info', 'merchant_discovery.completed', {
          svc: 'product-intelligence',
          candidate_count: 0,
          qualifying_count: seedRetained ? 1 : 0,
          seed_retained: seedRetained,
          duplicates_removed: 0,
          final_offer_count: seedRetained ? 1 : 0,
          discoveryEmpty: true,
        });
      }
      return {
        kind: 'Succeeded',
        candidates: seed ? [seed] : [],
        provider: seed ? 'direct_url' : this.discovery.name,
      };
    }

    // Serper is discovery-only — never use search snippets/images as catalog metadata.
    const discoveryCandidates = toDiscoveryCandidates(discovery.candidates);
    const identityHints = {
      brand: pdpHints.brand,
      name: pdpHints.name ?? query,
      category: pdpHints.category,
    };
    const shortlistLimit = userImportExpansion
      ? Math.max(1, hints?.maxAdditionalMerchantOffers ?? this.maxCandidates)
      : this.maxCandidates;
    const shortlisted = shortlistPdpCandidates(discoveryCandidates, identityHints, shortlistLimit);

    if (!shortlisted.length && !discoveryCandidates.length) {
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

    let pool = decoratePdpCandidates(discoveryCandidates, identityHints);
    const commerceCountry = hints?.commerceCountry ?? null;
    let preferred = pickPreferredMetadataTargets(pool, commerceCountry);
    let officialQueryUsed: string | null = null;
    let amazonQueryUsed: string | null = null;
    const marketplaceQueriesUsed: string[] = [];
    const hasOfficial = Boolean(preferred.find(isOfficialPreferredMetadataCandidate));
    const hasAmazon = Boolean(preferred.find(isAmazonPreferredMetadataCandidate));

    if (!hasOfficial || !hasAmazon || userImportExpansion) {
      const extraQueries: string[] = [];
      if (!hasOfficial) {
        officialQueryUsed = officialPreferredSearchQuery(query, pdpHints.brand);
        extraQueries.push(officialQueryUsed);
      }
      if (!hasAmazon || userImportExpansion) {
        amazonQueryUsed = amazonPreferredSearchQuery(query, commerceCountry);
        extraQueries.push(amazonQueryUsed);
      }
      if (userImportExpansion) {
        for (const mq of marketplacePreferredSearchQueries(query, commerceCountry)) {
          marketplaceQueriesUsed.push(mq);
          extraQueries.push(mq);
        }
      }
      const extraResults = await Promise.all(
        extraQueries.map((q) => this.discovery.search(q)),
      );
      const extraCandidates = extraResults.flatMap((result) =>
        result.kind === 'Succeeded' ? toDiscoveryCandidates(result.candidates) : [],
      );
      if (extraCandidates.length) {
        pool = decoratePdpCandidates(
          mergeSearchCandidates(discoveryCandidates, extraCandidates),
          identityHints,
        );
        preferred = pickPreferredMetadataTargets(pool, commerceCountry);
      }
    }

    ingestLog('info', 'metadata.enrichment.preferred_discovery', {
      svc: 'product-intelligence',
      preferredCount: preferred.length,
      preferredUrlList: preferred.map((c) => c.merchantUrl.slice(0, 160)).join(','),
      officialQueryUsed,
      amazonQueryUsed,
      marketplaceQueriesUsed: marketplaceQueriesUsed.join(' | ') || null,
      commerceCountry: commerceCountry ?? null,
    });

    // User-import: seed is retained separately; cap ADDITIONAL discovered merchants.
    // Preferred Official+Amazon always count first (full enrich for identity), then
    // fill remaining slots with lightweight URL-qualified merchants.
    const preferredForOffers = userImportExpansion
      ? preferred.slice(0, shortlistLimit)
      : preferred;
    const slotsLeft = userImportExpansion
      ? Math.max(0, shortlistLimit - preferredForOffers.length)
      : shortlisted.length;
    const remainingSource = userImportExpansion
      ? shortlistPdpCandidates(pool, identityHints, shortlistLimit + preferredForOffers.length)
      : shortlisted;
    const remaining = remainingSource
      .filter(
        (candidate) =>
          !preferredForOffers.some((target) =>
            merchantUrlsMatch(target.merchantUrl, candidate.merchantUrl),
          ),
      )
      .slice(0, userImportExpansion ? slotsLeft : remainingSource.length);
    preferred = preferredForOffers;

    const preferredResults =
      preferred.length > 0
        ? await Promise.all(preferred.map((best) => this.enrichShortlisted(best, pdpHints)))
        : [];
    const preferredEnriched = preferredResults.filter(
      (candidate): candidate is SearchCandidate => candidate !== null,
    );

    const mergeInputs = seed
      ? [
          seed,
          ...preferredEnriched.filter((c) => !merchantUrlsMatch(c.merchantUrl, seed.merchantUrl)),
        ]
      : preferredEnriched;
    const preferredCompleteness =
      mergeInputs.length > 0 ? mergeEnrichedCandidates(mergeInputs).metadataCompleteness : 0;

    ingestLog('info', 'metadata.enrichment.preferred_pass', {
      svc: 'product-intelligence',
      preferredCount: preferred.length,
      preferredUrlList: preferred.map((c) => c.merchantUrl.slice(0, 160)).join(','),
      mergedCompleteness: preferredCompleteness,
    });

    let enrichedCandidates = preferredEnriched;
    // Creator path may stop after Official+Amazon when metadata is already rich.
    // User-import (`enrichAllCommerce`) always continues so all valid merchants remain.
    const stopAfterPreferred =
      !hints?.enrichAllCommerce &&
      preferred.length > 0 &&
      shouldStopAfterPreferredMetadata(preferredCompleteness);
    if (!stopAfterPreferred) {
      ingestLog('info', 'metadata.enrichment.fallback_pass', {
        svc: 'product-intelligence',
        remainingCount: remaining.length,
        mergedCompleteness: preferredCompleteness,
        lightweight: Boolean(hints?.lightweightAdditionalMerchants),
      });
      const fallbackResults = hints?.lightweightAdditionalMerchants
        ? remaining.map((best) => this.toLightweightCommerceCandidate(best, pdpHints))
        : await Promise.all(remaining.map((best) => this.enrichShortlisted(best, pdpHints)));
      enrichedCandidates = [
        ...preferredEnriched,
        ...fallbackResults.filter((candidate): candidate is SearchCandidate => candidate !== null),
      ];
    } else {
      ingestLog('info', 'metadata.enrichment.preferred_complete', {
        svc: 'product-intelligence',
        mergedCompleteness: preferredCompleteness,
        skippedCount: remaining.length,
      });
    }

    const beforeDedupe = seed
      ? [seed, ...enrichedCandidates]
      : enrichedCandidates;
    const merged: SearchCandidate[] = [];
    let duplicatesRemoved = 0;
    for (const candidate of beforeDedupe) {
      if (merged.some((existing) => merchantUrlsMatch(existing.merchantUrl, candidate.merchantUrl))) {
        duplicatesRemoved += 1;
        continue;
      }
      merged.push(candidate);
    }

    if (userImportExpansion) {
      const qualifying = merged.filter(
        (c) =>
          c.enrichmentSucceeded === true &&
          (c.capabilities?.commerce ?? false) &&
          c.pdpVerdict === 'pdp',
      );
      ingestLog('info', 'merchant_discovery.completed', {
        svc: 'product-intelligence',
        candidate_count: discoveryCandidates.length,
        qualifying_count: qualifying.length,
        seed_retained: seedRetained,
        duplicates_removed: duplicatesRemoved,
        final_offer_count: merged.length,
      });
      ingestLog('info', 'merchant_discovery.candidate_count', {
        svc: 'product-intelligence',
        count: discoveryCandidates.length,
      });
      ingestLog('info', 'merchant_discovery.qualifying_count', {
        svc: 'product-intelligence',
        count: qualifying.length,
      });
      ingestLog('info', 'merchant_discovery.seed_retained', {
        svc: 'product-intelligence',
        retained: seedRetained,
      });
      ingestLog('info', 'merchant_discovery.duplicates_removed', {
        svc: 'product-intelligence',
        count: duplicatesRemoved,
      });
      ingestLog('info', 'merchant_discovery.final_offer_count', {
        svc: 'product-intelligence',
        count: merged.length,
      });
    }

    return {
      kind: 'Succeeded',
      candidates: merged,
      provider: this.discovery.name,
    };
  }

  /**
   * URL-only commerce candidate for user-import additional merchants.
   * Qualifies via existing shortlist + page/PDP classifiers; does not call Tavily.
   * Live price is deferred to MerchantPricingService.
   */
  private toLightweightCommerceCandidate(
    best: ShortlistedCandidate,
    pdpHints: ReturnType<typeof getPdpSearchHints>,
  ): SearchCandidate | null {
    if (!best.capabilities.commerce) return null;
    if (best.pdpVerdict === 'not_pdp') {
      ingestLog('info', 'search.pdp.rejected', {
        svc: 'product-intelligence',
        merchantUrl: best.merchantUrl.slice(0, 160),
        reason: 'lightweight_not_pdp',
      });
      return null;
    }

    const classification = classifyPdp({
      url: best.merchantUrl,
      title: best.title,
      snippet: best.snippet,
      expectedBrand: pdpHints.brand,
    });
    if (classification.verdict === 'not_pdp') {
      ingestLog('info', 'search.pdp.rejected', {
        svc: 'product-intelligence',
        merchantUrl: best.merchantUrl.slice(0, 160),
        reason: 'lightweight_not_pdp',
        pdpClassifierScore: classification.score,
      });
      return null;
    }

    // URL-only enrichment lacks Tavily metadata signals. Accept shortlisted commerce
    // PDPs when the page classifier already admitted them, or the URL is an exact
    // product buying path (same helpers used elsewhere for qualification).
    const rankScore01 =
      typeof best.pdpScore === 'number' && Number.isFinite(best.pdpScore)
        ? Math.min(1, Math.max(0, best.pdpScore / 100))
        : 0;
    const exactBuying = isExactProductBuyingUrl(best.merchantUrl);
    const score = Math.max(
      classification.score,
      rankScore01,
      exactBuying ? 0.5 : 0,
      classification.verdict === 'pdp' ? classification.score : 0,
    );
    if (score < 0.45 && classification.verdict !== 'pdp' && !exactBuying) {
      return null;
    }

    const merchant =
      best.merchant?.trim() ||
      (() => {
        try {
          return new URL(best.merchantUrl).hostname.replace(/^www\./i, '');
        } catch {
          return 'merchant';
        }
      })();

    const candidate: SearchCandidate = {
      merchant,
      merchantUrl: best.merchantUrl,
      title: best.title,
      image: best.image,
      score: Math.min(1, Math.max(0.5, best.pdpScore / 100)),
      snippet: best.snippet,
      brand: best.brand,
      pdpScore: score,
      pdpVerdict: 'pdp',
      pdpReasons: [
        ...classification.reasons,
        ...(exactBuying ? ['exact_product_buying_url'] : []),
        'lightweight_shortlist',
      ],
      enrichmentSucceeded: true,
      sourceTier: best.sourceTier,
      sourceType: best.sourceType,
      pageType: best.pageType,
      capabilities: best.capabilities,
      candidatePageType: best.candidatePageType,
      shoppingEligible: true,
      enrichmentMeta: {
        enrichmentProvider: 'discovery_url_only',
        pdp_rank_score: best.pdpScore,
        pdp_classifier_score: score,
        pdp_classifier_reasons: classification.reasons,
        source_tier: classification.sourceTier,
        lightweight: true,
      },
    };
    const decisionScores = scoreCandidateDecisions(candidate);
    candidate.sourceAuthority = decisionScores.sourceAuthority;
    candidate.metadataScore = decisionScores.metadataScore;
    candidate.shoppingScore = decisionScores.shoppingScore;
    return candidate;
  }

  private async enrichShortlisted(
    best: ShortlistedCandidate,
    pdpHints: ReturnType<typeof getPdpSearchHints>,
  ): Promise<SearchCandidate | null> {
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
