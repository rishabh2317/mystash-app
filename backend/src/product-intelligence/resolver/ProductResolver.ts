import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProductIntelligenceConfig } from '../config';
import type {
  AiDraftInput,
  CatalogProduct,
  ResolveDraftResult,
  SearchCandidate,
  VerificationStatus,
} from '../domain/types';
import type {
  DraftUpdater,
  MatchHistoryWriter,
} from '../interfaces/CatalogRepository';
import type { SearchStrategy } from '../interfaces/ProductSearchProvider';
import { MatchScorer } from '../matcher/MatchScorer';
import { ProductNormalizer } from '../normalizer/ProductNormalizer';
import { mergeEnrichedCandidates } from '../enrichment/MetadataMergeService';
import { emitPiEvent } from '../observability';
import { scoreProductSpecificity } from '../specificity/ProductSpecificityScorer';
import { buildProductSearchQuery } from '../search/ProductSearchQueryBuilder';
import { classifyCandidatePage } from '../search/CandidatePageClassifier';
import { scoreCandidateDecisions } from '../scoring/CandidateScoring';
import {
  pickVerificationMerchantUrl,
  resolveShoppingDestination,
} from '../../shopping/ShoppingDestinationResolver';
import {
  applyShoppingSelectionPrecedence,
} from '../../shopping/shoppingConfig';
import { resolveShoppingSelectionForProduct } from '../../shopping/ShoppingConfiguration';
import { decideProductVerification } from '../verification/verificationPolicy';
import { ingestLog } from '../../pipeline/ingestLog';
import type { CatalogService } from '../../catalog/CatalogService';
import { merchantUrlsMatch } from '../search/directUrlIdentity';

function aiFieldProvenance(provider = 'ai'): Record<string, { source: string; provider?: string }> {
  return {
    title: { source: 'ai', provider },
    brand: { source: 'ai', provider },
    price: { source: 'ai', provider },
    heroImage: { source: 'ai', provider },
  };
}

function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return 'unknown';
  }
}

function logCandidateDecision(
  candidate: SearchCandidate,
  decision: {
    selectedForMetadata: boolean;
    selectedForShopping: boolean;
    rejectionReason: string | null;
    shoppingScore?: number;
  },
): void {
  const scores = scoreCandidateDecisions(candidate);
  const classification = classifyCandidatePage({
    url: candidate.merchantUrl,
    sourceTier: candidate.sourceTier,
    title: candidate.title,
  });
  ingestLog('info', 'candidate.decision', {
    svc: 'product-intelligence',
    merchant: candidate.merchant ?? sourceHost(candidate.merchantUrl),
    sourceType: candidate.sourceType ?? classification.sourceType,
    pageType: candidate.pageType ?? classification.pageType,
    metadataScore: candidate.metadataScore ?? scores.metadataScore,
    shoppingScore: decision.shoppingScore ?? candidate.shoppingScore ?? scores.shoppingScore,
    sourceAuthority: candidate.sourceAuthority ?? scores.sourceAuthority,
    pdpScore: candidate.pdpScore ?? 0,
    metadataCompleteness: scores.metadataCompleteness,
    metadataCapable:
      candidate.capabilities?.metadata ?? classification.capabilities.metadata,
    commerceCapable:
      candidate.capabilities?.commerce ?? classification.capabilities.commerce,
    selectedForMetadata: decision.selectedForMetadata,
    selectedForShopping: decision.selectedForShopping,
    rejectionReason: decision.rejectionReason,
  });
}

export type BackgroundResolveEnqueuer = {
  enqueue(job: {
    draftId: string;
    ingestId: string;
    videoProductId?: string;
  }): Promise<void>;
};

export class ProductResolver {
  private readonly normalizer = new ProductNormalizer();
  private readonly scorer = new MatchScorer();

  constructor(
    private readonly catalog: CatalogService,
    private readonly search: SearchStrategy,
    private readonly drafts: DraftUpdater,
    private readonly history: MatchHistoryWriter,
    private readonly cfg: ProductIntelligenceConfig,
    private readonly background: BackgroundResolveEnqueuer | null,
    private readonly ingestId: string,
  ) {}

  async resolveIngest(drafts: AiDraftInput[]): Promise<ResolveDraftResult[]> {
    const out: ResolveDraftResult[] = [];
    for (const d of drafts) {
      out.push(await this.resolveOne(d));
    }
    return out;
  }

  private async resolveOne(draft: AiDraftInput): Promise<ResolveDraftResult> {
    const norm = this.normalizer.normalize(draft);
    const specificity = scoreProductSpecificity(draft, norm, this.cfg.specificityMin);
    const t0 = performance.now();
    emitPiEvent('specificity.assessed', {
      draftId: draft.draftId,
      specificityScore: specificity.score,
      threshold: this.cfg.specificityMin,
      decision: specificity.decision,
      reason: specificity.reasons.join(','),
    });

    if (specificity.decision !== 'searchable') {
      const decision = 'insufficient_specificity';
      const reason = specificity.reasons.join(',');
      const unverified = await this.upsertCatalog(draft.catalogProductId, {
        name: norm.name,
        normalizedName: norm.normalizedName,
        canonicalSlug: norm.canonicalSlugBase,
        brand: norm.brand,
        model: norm.model,
        category: norm.category,
        imageUrl: norm.imageHint,
        merchantUrl: norm.merchantUrlHint ?? null,
        price: norm.priceHint,
        currency: norm.currencyHint,
        verificationStatus: 'UNVERIFIED',
        verificationSource: 'ai_specificity_gate',
        verificationVersion: this.cfg.verificationVersion,
        aiConfidence: norm.aiConfidence,
        matchConfidence: null,
        verificationConfidence: specificity.score,
        aliases: norm.aliases,
        metadata: {
          source: 'ai_specificity_gate',
          field_provenance: aiFieldProvenance(),
          scores: { specificity: specificity.score },
          verification: {
            decision,
            reason,
            status: 'UNVERIFIED',
            source: 'ai_specificity_gate',
            version: this.cfg.verificationVersion,
          },
        },
      });
      emitPiEvent('specificity.gated', {
        draftId: draft.draftId,
        catalogId: unverified.id,
        specificityScore: specificity.score,
        reason,
      });
      return this.finishWithCatalog(
        draft,
        norm.aiConfidence,
        unverified,
        0,
        decision,
        reason,
        { specificityScore: specificity.score, pdpClassifierScore: null },
      );
    }

    const localHit = await this.catalog.localSearch(norm);
    if (
      localHit &&
      localHit.score >= this.cfg.catalogHitMinScore &&
      localHit.product.verificationStatus === 'VERIFIED'
    ) {
      emitPiEvent('catalog.hit', {
        draftId: draft.draftId,
        via: localHit.via,
        score: localHit.score,
      });
      const hit = localHit.product;
      const localProduct = await this.catalog.createOrUpdateFromResolve(hit.id, {
        name: hit.name,
        normalizedName: hit.normalizedName,
        canonicalSlug: hit.canonicalSlug,
        brand: hit.brand,
        model: hit.model,
        category: hit.category,
        description: hit.description,
        imageUrl: hit.imageUrl,
        merchant: hit.merchant,
        merchantUrl: hit.merchantUrl,
        preferredShoppingUrl: hit.preferredShoppingUrl,
        shoppingProvider: hit.shoppingProvider,
        currency: hit.currency,
        price: hit.price,
        verificationStatus: 'VERIFIED',
        verificationProvider: hit.verificationProvider ?? 'catalog',
        verificationSource: 'catalog',
        verificationVersion: this.cfg.verificationVersion,
        aiConfidence: hit.aiConfidence,
        matchConfidence: localHit.score,
        verificationConfidence: hit.verificationConfidence,
        metadata: {
          field_provenance:
            hit.metadata.field_provenance ?? {
              title: { source: 'catalog' },
              brand: { source: 'catalog' },
              price: { source: 'catalog' },
              heroImage: { source: 'catalog' },
              merchant: { source: 'catalog' },
            },
          scores: {
            specificity: specificity.score,
            match: localHit.score,
          },
          verification: {
            decision: 'local_hit',
            reason: localHit.via,
            status: 'VERIFIED',
            source: 'catalog',
            version: this.cfg.verificationVersion,
          },
        },
      });
      return this.finishWithCatalog(
        draft,
        norm.aiConfidence,
        localProduct,
        localHit.score,
        'local_hit',
        localHit.via,
        { specificityScore: specificity.score, pdpClassifierScore: null },
      );
    }

    emitPiEvent('catalog.miss', { draftId: draft.draftId });
    const builtQuery = buildProductSearchQuery(draft, norm);
    emitPiEvent('search.query_built', {
      draftId: draft.draftId,
      query: builtQuery.query.slice(0, 240),
      reason: builtQuery.reasons.join(','),
      specificityScore: specificity.score,
    });
    const creatorUrl = draft.creatorSuppliedUrl ? draft.merchantUrl ?? null : null;
    const searchResult = await this.search.search(
      builtQuery.query,
      creatorUrl
        ? { seedMerchantUrl: creatorUrl, skipDiscoveryIfSeedStrong: true }
        : undefined,
    );

    if (searchResult.kind === 'Failed') {
      emitPiEvent('search.failed', {
        draftId: draft.draftId,
        errorKind: searchResult.errorKind,
        durationMs: Math.round(performance.now() - t0),
      });
      // Always persist an UNRESOLVED catalog row so UI never depends on external providers.
      const unresolved = await this.upsertCatalog(draft.catalogProductId, {
        name: norm.name,
        normalizedName: norm.normalizedName,
        canonicalSlug: norm.canonicalSlugBase,
        brand: norm.brand,
        model: norm.model,
        category: norm.category,
        imageUrl: norm.imageHint,
        merchantUrl: norm.merchantUrlHint ?? null,
        price: norm.priceHint,
        currency: norm.currencyHint,
        verificationStatus: 'UNRESOLVED',
        verificationSource: 'search_failed',
        verificationVersion: this.cfg.verificationVersion,
        aiConfidence: norm.aiConfidence,
        matchConfidence: null,
        verificationConfidence: 0,
        aliases: norm.aliases,
        metadata: {
          source: 'unresolved_placeholder',
          errorKind: searchResult.errorKind,
          message: searchResult.message.slice(0, 200),
          field_provenance: aiFieldProvenance(),
          scores: { specificity: specificity.score },
          verification: {
            decision: 'unresolved_search_failed',
            reason: `${searchResult.errorKind}: ${searchResult.message}`.slice(0, 240),
            status: 'UNRESOLVED',
            source: 'search_failed',
            version: this.cfg.verificationVersion,
          },
        },
      });
      emitPiEvent('draft.unresolved', { draftId: draft.draftId, catalogId: unresolved.id });
      const result = await this.finishWithCatalog(
        draft,
        norm.aiConfidence,
        unresolved,
        0,
        'unresolved_search_failed',
        `${searchResult.errorKind}: ${searchResult.message}`,
        { specificityScore: specificity.score, pdpClassifierScore: null },
      );
      if (this.background && this.cfg.backgroundResolve) {
        await this.background.enqueue({ draftId: draft.draftId, ingestId: this.ingestId });
        emitPiEvent('resolve.background_enqueued', { draftId: draft.draftId });
      }
      // finishWithCatalog sets enqueueBackground false — mark for callers
      return { ...result, enqueueBackground: true };
    }

    if (searchResult.candidates.length === 0) {
      emitPiEvent('search.succeeded_empty', { draftId: draft.draftId });
      const created = await this.upsertCatalog(draft.catalogProductId, {
        name: norm.name,
        normalizedName: norm.normalizedName,
        canonicalSlug: norm.canonicalSlugBase,
        brand: norm.brand,
        model: norm.model,
        category: norm.category,
        imageUrl: norm.imageHint,
        merchantUrl: creatorUrl ?? null,
        price: norm.priceHint,
        currency: norm.currencyHint,
        verificationStatus: 'UNVERIFIED',
        verificationSource: 'ai_fallback',
        verificationVersion: this.cfg.verificationVersion,
        aiConfidence: norm.aiConfidence,
        matchConfidence: null,
        verificationConfidence: 0.2,
        aliases: norm.aliases,
        metadata: {
          source: 'ai_fallback',
          field_provenance: aiFieldProvenance(),
          scores: { specificity: specificity.score },
          verification: {
            decision: 'created_unverified_empty_search',
            reason: 'search succeeded with no acceptable PDP',
            status: 'UNVERIFIED',
            source: 'ai_fallback',
            version: this.cfg.verificationVersion,
          },
        },
      });
      emitPiEvent('catalog.created_unverified', { catalogId: created.id });
      return this.finishWithCatalog(
        draft,
        norm.aiConfidence,
        created,
        0.4,
        'created_unverified_empty_search',
        'search succeeded with no acceptable PDP',
        { specificityScore: specificity.score, pdpClassifierScore: null },
      );
    }

    const metadataCandidates = searchResult.candidates.filter(
      (c) =>
        c.enrichmentSucceeded === true &&
        (Boolean(creatorUrl && merchantUrlsMatch(c.merchantUrl, creatorUrl)) ||
          this.scorer.score(norm, c).score >= this.cfg.verificationMatchMin),
    );
    const commerceCandidates = metadataCandidates.filter(
      (c) => {
        const classification = classifyCandidatePage({
          url: c.merchantUrl,
          sourceTier: c.sourceTier,
          title: c.title,
        });
        return (
          (c.capabilities ?? classification.capabilities).commerce &&
          c.pdpVerdict === 'pdp' &&
          (c.pdpScore ?? 0) >= this.cfg.pdpClassifierMin
        );
      },
    );

    if (!metadataCandidates.length) {
      const metadataCandidateUrls = new Set(
        metadataCandidates.map((candidate) => candidate.merchantUrl),
      );
      for (const candidate of searchResult.candidates) {
        logCandidateDecision(candidate, {
          selectedForMetadata: false,
          selectedForShopping: false,
          rejectionReason: metadataCandidateUrls.has(candidate.merchantUrl)
            ? 'no_purchasable_offer'
            : candidate.enrichmentSucceeded
              ? 'below_match_threshold'
              : 'enrichment_failed',
        });
      }
      const scoredBest = this.scorer.pickBest(
        norm,
        searchResult.candidates,
        this.cfg.verificationMatchMin,
      );
      emitPiEvent('search.succeeded_empty', { draftId: draft.draftId, reason: 'no_score' });
      const created = await this.upsertCatalog(draft.catalogProductId, {
        name: norm.name,
        normalizedName: norm.normalizedName,
        canonicalSlug: norm.canonicalSlugBase,
        brand: norm.brand,
        model: norm.model,
        category: norm.category,
        imageUrl: norm.imageHint,
        verificationStatus: 'UNVERIFIED',
        verificationSource: 'ai_fallback',
        verificationVersion: this.cfg.verificationVersion,
        aiConfidence: norm.aiConfidence,
        verificationConfidence: 0.2,
        aliases: norm.aliases,
        metadata: {
          source: 'ai_fallback_low_score',
          field_provenance: aiFieldProvenance(),
          scores: {
            specificity: specificity.score,
            pdpClassifier: scoredBest?.candidate.pdpScore ?? null,
            match: scoredBest?.match.score ?? null,
          },
          verification: {
            decision: 'created_unverified_low_score',
            reason: scoredBest
              ? 'candidate failed PDP/enrichment verification policy'
              : 'candidates below match threshold',
            status: 'UNVERIFIED',
            source: 'ai_fallback',
            version: this.cfg.verificationVersion,
          },
        },
      });
      return this.finishWithCatalog(
        draft,
        norm.aiConfidence,
        created,
        0.35,
        'created_unverified_low_score',
        scoredBest
          ? 'candidate failed PDP/enrichment verification policy'
          : 'candidates below match threshold',
        {
          specificityScore: specificity.score,
          pdpClassifierScore: scoredBest?.candidate.pdpScore ?? null,
        },
      );
    }

    const merged = mergeEnrichedCandidates(metadataCandidates);
    ingestLog('info', 'metadata.merge.completed', {
      svc: 'product-intelligence',
      draftId: draft.draftId,
      metadataSources: merged.metadataSources.join(','),
      metadataCompleteness: merged.metadataCompleteness,
      fieldCount: Object.keys(merged.metadataSourceMap).length,
    });

    const verification = pickVerificationMerchantUrl(
      commerceCandidates.map((c) => ({
        url: c.merchantUrl,
        sourceTier: c.sourceTier,
        merchant: c.merchant,
        sourceType: c.sourceType,
        pageType: c.pageType,
        capabilities: c.capabilities,
        sourceAuthority: c.sourceAuthority,
        pdpScore: c.pdpScore,
        availability:
          typeof c.enrichmentMeta?.availability === 'string'
            ? c.enrichmentMeta.availability
            : null,
        affiliateSupported: false,
      })),
    );

    const existingCatalog = draft.catalogProductId
      ? await this.catalog.getById(draft.catalogProductId)
      : null;
    const shoppingResolvedSelection = resolveShoppingSelectionForProduct(
      draft.catalogProductId ?? existingCatalog?.id ?? null,
      existingCatalog?.metadata ?? null,
    );

    const shoppingResolved = resolveShoppingDestination(
      commerceCandidates.map((c) => ({
        url: c.merchantUrl,
        sourceTier: c.sourceTier,
        merchant: c.merchant,
        sourceType: c.sourceType,
        pageType: c.pageType,
        capabilities: c.capabilities,
        sourceAuthority: c.sourceAuthority,
        pdpScore: c.pdpScore,
        availability:
          typeof c.enrichmentMeta?.availability === 'string'
            ? c.enrichmentMeta.availability
            : null,
        affiliateSupported: false,
      })),
      shoppingResolvedSelection.merchantPriority,
    );

    const shoppingChoice = applyShoppingSelectionPrecedence({
      config: shoppingResolvedSelection.selection,
      discoveredOffers: commerceCandidates.map((c) => ({
        url: c.merchantUrl,
        sourceType: c.sourceType,
      })),
      resolverWinnerUrl: shoppingResolved?.preferredShoppingUrl ?? null,
      priority: shoppingResolvedSelection.merchantPriority,
    });
    const shopping =
      shoppingChoice.preferredShoppingUrl != null
        ? {
            preferredShoppingUrl: shoppingChoice.preferredShoppingUrl,
            shoppingProvider:
              shoppingChoice.shoppingProvider ??
              shoppingResolved?.shoppingProvider ??
              'merchant',
            offers: shoppingResolved?.offers ?? [],
            selectionSource: shoppingChoice.source,
          }
        : null;

    const metadataWinners = new Set(
      Object.values(merged.metadataSourceMap).map((field) => field.source),
    );
    const metadataCandidateUrls = new Set(
      metadataCandidates.map((candidate) => candidate.merchantUrl),
    );
    for (const candidate of searchResult.candidates) {
      const classification = classifyCandidatePage({
        url: candidate.merchantUrl,
        sourceTier: candidate.sourceTier,
        title: candidate.title,
      });
      const selectedForMetadata = metadataWinners.has(sourceHost(candidate.merchantUrl));
      const selectedShoppingOffer = shopping?.offers.find(
        (offer) => offer.url === candidate.merchantUrl,
      );
      const selectedForShopping =
        shopping?.preferredShoppingUrl === candidate.merchantUrl;
      logCandidateDecision(candidate, {
        selectedForMetadata,
        selectedForShopping,
        shoppingScore: selectedShoppingOffer?.shoppingScore,
        rejectionReason: selectedForShopping
          ? null
          : !metadataCandidateUrls.has(candidate.merchantUrl)
            ? candidate.enrichmentSucceeded
              ? 'below_match_threshold'
              : 'enrichment_failed'
            : (candidate.capabilities ?? classification.capabilities).commerce
              ? 'lower_shopping_score'
              : 'commerce_capability_disabled',
      });
    }

    const decisionCandidates = commerceCandidates.length
      ? commerceCandidates
      : metadataCandidates;
    const matchScores = decisionCandidates.map((c) => this.scorer.score(norm, c));
    const bestMatch = matchScores.reduce((a, b) => (a.score >= b.score ? a : b));
    const bestPdpScore = Math.max(...decisionCandidates.map((c) => c.pdpScore ?? 0));

    const hasShoppingOffer = commerceCandidates.length > 0;
    const seedCandidate =
      creatorUrl != null
        ? searchResult.candidates.find(
            (c) => c.enrichmentSucceeded && merchantUrlsMatch(c.merchantUrl, creatorUrl),
          ) ?? null
        : null;
    const identityUrl = creatorUrl ?? shopping?.preferredShoppingUrl ??
      commerceCandidates.find((c) => c.merchantUrl)?.merchantUrl ??
      null;
    const verificationDecision = decideProductVerification({
      hasCommerceOffer: hasShoppingOffer,
      bestMatch,
      identityUrl,
      bestPdpScore,
      catalogHitMinScore: this.cfg.catalogHitMinScore,
      verificationMatchMin: this.cfg.verificationMatchMin,
      pdpClassifierMin: this.cfg.pdpClassifierMin,
      hadExistingCatalog: Boolean(draft.catalogProductId),
    });
    const verificationStatus = verificationDecision.verificationStatus;
    const resolutionDecision = verificationDecision.decision;
    const fieldProvenance: Record<
      string,
      {
        source: string;
        provider?: string;
        confidence: number;
        value: unknown;
        metadataScore: number;
        sourceType: string;
        pageType: string;
        trustRank: number;
      }
    > = {};
    for (const [field, entry] of Object.entries(merged.metadataSourceMap)) {
      fieldProvenance[field] = {
        source: 'merchant',
        provider: entry.source,
        confidence: entry.confidence,
        value: entry.value,
        metadataScore: entry.metadataScore,
        sourceType: entry.sourceType,
        pageType: entry.pageType,
        trustRank: entry.trustRank,
      };
    }

    const created = await this.upsertCatalog(draft.catalogProductId, {
      name: (creatorUrl ? seedCandidate?.title : null) || merged.title || norm.name,
      normalizedName: norm.normalizedName,
      canonicalSlug: norm.canonicalSlugBase,
      brand: (creatorUrl ? seedCandidate?.brand : null) || merged.brand || norm.brand,
      model: merged.model ?? norm.model,
      category: merged.category ?? norm.category,
      description: merged.description ?? seedCandidate?.description ?? null,
      imageUrl: merged.heroImage ?? seedCandidate?.image ?? norm.imageHint,
      merchant: seedCandidate?.merchant ?? merged.offer?.merchant ?? verification?.merchant ?? null,
      merchantUrl: creatorUrl ?? merged.offer?.merchantUrl ?? verification?.merchantUrl ?? null,
      preferredShoppingUrl: shopping?.preferredShoppingUrl ?? creatorUrl ?? null,
      affiliateUrl: merged.offer?.affiliateUrl ?? null,
      shoppingProvider: shopping?.shoppingProvider ?? null,
      price: merged.offer?.price ?? null,
      currency: merged.offer?.currency ?? null,
      verificationStatus,
      verificationSource: searchResult.provider,
      verificationProvider: searchResult.provider,
      verificationVersion: this.cfg.verificationVersion,
      aiConfidence: norm.aiConfidence,
      matchConfidence: bestMatch.matchConfidence,
      verificationConfidence: Math.min(
        1,
        bestMatch.score + (verificationStatus === 'VERIFIED' ? 0.1 : 0),
      ),
      aliases: norm.aliases,
      metadata: {
        source: searchResult.provider,
        ...(merged.description ? { description: merged.description } : {}),
        ...(merged.shortDescription ? { short_description: merged.shortDescription } : {}),
        specifications: merged.specifications,
        gallery: merged.gallery,
        primary_image: merged.heroImage,
        availability: merged.availability,
        offer: merged.offer,
        frameRefs: merged.frameRefs,
        evidence: merged.evidence,
        evidenceProvenance: merged.evidenceProvenance,
        metadata_completeness: merged.metadataCompleteness,
        metadataSources: merged.metadataSources,
        metadataSourceMap: merged.metadataSourceMap,
        metadataCandidates: metadataCandidates.map((candidate) => {
          const usage = classifyCandidatePage({
            url: candidate.merchantUrl,
            sourceTier: candidate.sourceTier,
            title: candidate.title,
          });
          return {
            url: candidate.merchantUrl,
            sourceTier: candidate.sourceTier ?? 'retailer',
            sourceType: candidate.sourceType ?? usage.sourceType,
            pageType: candidate.pageType ?? usage.pageType,
            capabilities: candidate.capabilities ?? usage.capabilities,
            candidatePageType:
              candidate.candidatePageType ?? usage.candidatePageType,
            shoppingEligible:
              candidate.capabilities?.commerce ?? usage.capabilities.commerce,
            sourceAuthority:
              candidate.sourceAuthority ?? scoreCandidateDecisions(candidate).sourceAuthority,
            metadataScore:
              candidate.metadataScore ?? scoreCandidateDecisions(candidate).metadataScore,
          };
        }),
        shopping_candidates: shopping?.offers ?? [],
        // Preserve business shopping config; never replace with pipeline evidence.
        ...(existingCatalog?.metadata?.shoppingSelection
          ? { shoppingSelection: existingCatalog.metadata.shoppingSelection }
          : {}),
        shoppingSelectionSource: shoppingChoice.source,
        field_provenance: fieldProvenance,
        scores: {
          specificity: specificity.score,
          pdpClassifier: bestPdpScore,
          match: bestMatch.score,
          metadataCompleteness: merged.metadataCompleteness,
          enrichedCandidateCount: metadataCandidates.length,
          shoppingCandidateCount: commerceCandidates.length,
        },
        verification: {
          decision: resolutionDecision,
          reason: bestMatch.reason,
          status: verificationStatus,
          identityPath: verificationDecision.identityPath,
          source: searchResult.provider,
          sourceTier: verification?.sourceTier ?? 'retailer',
          version: this.cfg.verificationVersion,
        },
      },
    });
    emitPiEvent(
      verificationStatus === 'VERIFIED'
        ? 'catalog.created_verified'
        : 'catalog.created_unverified',
      { catalogId: created.id },
    );
    return this.finishWithCatalog(
      draft,
      norm.aiConfidence,
      created,
      bestMatch.score,
      resolutionDecision,
      bestMatch.reason,
      {
        specificityScore: specificity.score,
        pdpClassifierScore: bestPdpScore,
      },
    );
  }

  /**
   * Background enrichment updates an existing catalog row in place.
   * First-time resolve creates a new catalog row.
   * All persistence goes through CatalogService (Catalog BC).
   */
  private async upsertCatalog(
    existingId: string | null | undefined,
    input: Parameters<CatalogService['createFromResolve']>[0],
  ): Promise<CatalogProduct> {
    return this.catalog.createOrUpdateFromResolve(existingId, input);
  }

  private async finishWithCatalog(
    draft: AiDraftInput,
    aiConfidence: number,
    product: CatalogProduct,
    matchScore: number,
    decision: string,
    reason: string,
    quality: { specificityScore: number; pdpClassifierScore: number | null } = {
      specificityScore: 0,
      pdpClassifierScore: null,
    },
  ): Promise<ResolveDraftResult> {
    // preferredShoppingUrl: configured URL / preferred-merchant exact / resolver — never force to merchantUrl.
    const merchantUrl = product.merchantUrl;

    const status: VerificationStatus = product.verificationStatus;
    const result: ResolveDraftResult = {
      draftId: draft.draftId,
      resolutionStatus: status === 'UNRESOLVED' ? 'UNRESOLVED' : status,
      catalogProductId: product.id,
      merchantUrl,
      // Affiliate generation is not part of verification. ShoppingResolver
      // decides the destination at click time and ignores legacy wrappers.
      affiliateUrl: null,
      aiConfidence,
      matchConfidence: matchScore,
      decision,
      reason,
      enqueueBackground: false,
      specificityScore: quality.specificityScore,
      pdpClassifierScore: quality.pdpClassifierScore,
    };
    const provenance = product.metadata.metadataSourceMap ?? product.metadata.field_provenance;
    emitPiEvent('verification.decided', {
      draftId: draft.draftId,
      catalogId: product.id,
      finalStatus: status,
      decision,
      reason: reason.slice(0, 240),
      specificityScore: quality.specificityScore,
      pdpClassifierScore: quality.pdpClassifierScore,
      matchScore,
      preferredShoppingUrl: product.preferredShoppingUrl,
      shoppingProvider: product.shoppingProvider,
      metadataSources: Array.isArray(product.metadata.metadataSources)
        ? product.metadata.metadataSources.join(',')
        : null,
      metadataSourceMap: provenance ? JSON.stringify(provenance).slice(0, 500) : null,
    });
    await this.persistDraft(result, product, draft);
    await this.history.write({
      draftId: draft.draftId,
      catalogProductId: product.id,
      score: matchScore,
      decision,
      reason,
      aiConfidence,
      matchConfidence: matchScore,
      verificationConfidence: product.verificationConfidence,
    });
    return result;
  }

  private async persistDraft(
    result: ResolveDraftResult,
    product?: CatalogProduct,
    draft?: AiDraftInput,
  ): Promise<void> {
    await this.drafts.updateResolution({
      draftId: result.draftId,
      catalogProductId: result.catalogProductId,
      resolutionStatus: result.resolutionStatus,
      merchantUrl: result.merchantUrl,
      affiliateUrl: result.affiliateUrl,
      aiConfidence: result.aiConfidence,
      matchConfidence: result.matchConfidence,
      displayName: product?.name,
      // Never erase the extraction image when catalog enrichment has no image.
      displayImage: product?.imageUrl?.startsWith('http') ? product.imageUrl : undefined,
      displayPrice: product?.price && product.price !== '—' ? product.price : undefined,
      displayCurrency: product?.currency,
      // Keep provider='manual' so CollectionProductTag mapping stays CREATOR_MANUAL.
      displayProvider: draft?.creatorSuppliedUrl ? undefined : product?.merchant,
      displayBrand: product?.brand,
    });
  }
}

export class SupabaseDraftUpdater implements DraftUpdater {
  constructor(private readonly admin: SupabaseClient) {}

  async updateResolution(update: {
    draftId: string;
    catalogProductId: string | null;
    resolutionStatus: VerificationStatus;
    merchantUrl: string | null;
    affiliateUrl: string | null;
    aiConfidence: number;
    matchConfidence: number | null;
    displayName?: string | null;
    displayImage?: string | null;
    displayPrice?: string | null;
    displayCurrency?: string | null;
    displayProvider?: string | null;
    displayBrand?: string | null;
  }): Promise<void> {
    const patch: Record<string, unknown> = {
      catalog_product_id: update.catalogProductId,
      resolution_status: update.resolutionStatus,
      merchant_url: update.merchantUrl,
      ai_confidence: update.aiConfidence,
      match_confidence: update.matchConfidence,
    };
    // affiliate_url is NOT NULL historically — use empty string when unresolved
    patch.affiliate_url = update.affiliateUrl ?? '';
    if (update.displayName) patch.name = update.displayName;
    if (update.displayImage !== undefined) patch.image = update.displayImage;
    if (update.displayPrice) patch.price = update.displayPrice;
    if (update.displayCurrency !== undefined) patch.currency = update.displayCurrency;
    if (update.displayProvider) patch.provider = update.displayProvider;
    if (update.displayBrand !== undefined) patch.brand = update.displayBrand;
    await this.admin.from('ingest_draft_products').update(patch).eq('id', update.draftId);
  }
}
