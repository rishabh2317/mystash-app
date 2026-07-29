import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProductIntelligenceConfig } from '../config';
import type {
  AiDraftInput,
  CatalogProduct,
  ResolveDraftResult,
  VerificationStatus,
} from '../domain/types';
import type { AffiliateProvider } from '../interfaces/AffiliateProvider';
import type {
  CatalogRepository,
  DraftUpdater,
  MatchHistoryWriter,
} from '../interfaces/CatalogRepository';
import type { SearchStrategy } from '../interfaces/ProductSearchProvider';
import { LocalCatalogSearch } from '../catalog/LocalCatalogSearch';
import { MatchScorer } from '../matcher/MatchScorer';
import { ProductNormalizer } from '../normalizer/ProductNormalizer';
import { emitPiEvent } from '../observability';
import { scoreProductSpecificity } from '../specificity/ProductSpecificityScorer';
import { buildProductSearchQuery } from '../search/ProductSearchQueryBuilder';

function aiFieldProvenance(provider = 'ai'): Record<string, { source: string; provider?: string }> {
  return {
    title: { source: 'ai', provider },
    brand: { source: 'ai', provider },
    price: { source: 'ai', provider },
    heroImage: { source: 'ai', provider },
  };
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
  private readonly local: LocalCatalogSearch;
  private readonly scorer = new MatchScorer();

  constructor(
    private readonly catalog: CatalogRepository,
    private readonly search: SearchStrategy,
    private readonly affiliate: AffiliateProvider,
    private readonly drafts: DraftUpdater,
    private readonly history: MatchHistoryWriter,
    private readonly cfg: ProductIntelligenceConfig,
    private readonly background: BackgroundResolveEnqueuer | null,
    private readonly ingestId: string,
  ) {
    this.local = new LocalCatalogSearch(catalog);
  }

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

    const localHit = await this.local.search(norm);
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
      const localProduct = await this.catalog.update(localHit.product.id, {
        metadata: {
          field_provenance:
            localHit.product.metadata.field_provenance ?? {
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
    const searchResult = await this.search.search(builtQuery.query);

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
        merchantUrl: null,
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

    const scoredBest = this.scorer.pickBest(
      norm,
      searchResult.candidates,
      this.cfg.verificationMatchMin,
    );
    const best =
      scoredBest &&
      scoredBest.candidate.enrichmentSucceeded === true &&
      scoredBest.candidate.pdpVerdict === 'pdp' &&
      scoredBest.candidate.sourceTier !== 'editorial' &&
      (scoredBest.candidate.pdpScore ?? 0) >= this.cfg.pdpClassifierMin
        ? scoredBest
        : null;
    if (scoredBest && !best) {
      emitPiEvent('pdp.rejected', {
        draftId: draft.draftId,
        pdpClassifierScore: scoredBest.candidate.pdpScore ?? null,
        reason: scoredBest.candidate.pdpReasons?.join(',') ?? 'missing_enrichment_or_pdp_evidence',
      });
    }
    if (!best) {
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

    const verifiedDecision = draft.catalogProductId ? 'updated_verified' : 'created_verified';
    const enrichmentProvider =
      typeof best.candidate.enrichmentMeta?.enrichmentProvider === 'string'
        ? best.candidate.enrichmentMeta.enrichmentProvider
        : searchResult.provider;
    const created = await this.upsertCatalog(draft.catalogProductId, {
      name: best.candidate.title || norm.name,
      normalizedName: norm.normalizedName,
      canonicalSlug: norm.canonicalSlugBase,
      brand: best.candidate.brand ?? norm.brand,
      model: norm.model,
      category: norm.category,
      description: best.candidate.description ?? null,
      imageUrl: best.candidate.image ?? norm.imageHint,
      merchant: best.candidate.merchant,
      merchantUrl: best.candidate.merchantUrl,
      price: best.candidate.price ?? norm.priceHint,
      currency: best.candidate.currency ?? norm.currencyHint,
      verificationStatus: 'VERIFIED',
      verificationSource: searchResult.provider,
      verificationVersion: this.cfg.verificationVersion,
      aiConfidence: norm.aiConfidence,
      matchConfidence: best.match.matchConfidence,
      verificationConfidence: Math.min(1, best.match.score + 0.1),
      aliases: norm.aliases,
      metadata: {
        source: searchResult.provider,
        ...(best.candidate.description ? { description: best.candidate.description } : {}),
        ...(best.candidate.enrichmentMeta ?? {}),
        field_provenance: {
          title: { source: 'merchant', provider: enrichmentProvider },
          brand: {
            source: best.candidate.brand ? 'merchant' : 'ai',
            provider: best.candidate.brand ? enrichmentProvider : 'ai',
          },
          price: {
            source: best.candidate.price ? 'merchant' : 'ai',
            provider: best.candidate.price ? enrichmentProvider : 'ai',
          },
          heroImage: {
            source: best.candidate.image ? 'merchant' : 'ai',
            provider: best.candidate.image ? enrichmentProvider : 'ai',
          },
          merchant: { source: 'discovery', provider: searchResult.provider },
          description: { source: 'merchant', provider: enrichmentProvider },
        },
        scores: {
          specificity: specificity.score,
          pdpClassifier: best.candidate.pdpScore ?? null,
          candidate: best.candidate.score,
          match: best.match.score,
          metadataCompleteness:
            typeof best.candidate.enrichmentMeta?.metadata_completeness === 'number'
              ? best.candidate.enrichmentMeta.metadata_completeness
              : null,
        },
        verification: {
          decision: verifiedDecision,
          reason: best.match.reason,
          status: 'VERIFIED',
          source: searchResult.provider,
          sourceTier: best.candidate.sourceTier ?? 'retailer',
          version: this.cfg.verificationVersion,
        },
      },
    });
    emitPiEvent('catalog.created_verified', { catalogId: created.id });
    return this.finishWithCatalog(
      draft,
      norm.aiConfidence,
      created,
      best.match.score,
      verifiedDecision,
      best.match.reason,
      {
        specificityScore: specificity.score,
        pdpClassifierScore: best.candidate.pdpScore ?? null,
      },
    );
  }

  /**
   * Background enrichment updates an existing catalog row in place.
   * First-time resolve creates a new catalog row.
   */
  private async upsertCatalog(
    existingId: string | null | undefined,
    input: Parameters<CatalogRepository['create']>[0],
  ): Promise<CatalogProduct> {
    if (existingId) {
      const existing = await this.catalog.findById(existingId);
      if (existing) {
        return this.catalog.update(existingId, {
          name: input.name,
          brand: input.brand ?? existing.brand,
          model: input.model ?? existing.model,
          category: input.category ?? existing.category,
          description: input.description ?? existing.description,
          imageUrl: input.imageUrl ?? existing.imageUrl,
          merchant: input.merchant ?? existing.merchant,
          merchantUrl: input.merchantUrl ?? existing.merchantUrl,
          price: input.price ?? existing.price,
          currency: input.currency ?? existing.currency,
          verificationStatus: input.verificationStatus,
          verificationSource: input.verificationSource,
          verificationVersion: input.verificationVersion,
          aiConfidence: input.aiConfidence,
          matchConfidence: input.matchConfidence,
          verificationConfidence: input.verificationConfidence,
          metadata: input.metadata,
        });
      }
    }
    return this.catalog.create(input);
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
    const merchantUrl = product.merchantUrl;
    let affiliateUrl: string | null = product.affiliateUrl;
    if (merchantUrl) {
      const aff = await this.affiliate.resolve({
        merchantUrl,
        catalogProductId: product.id,
        ingestId: this.ingestId,
      });
      affiliateUrl = aff.affiliateUrl;
      emitPiEvent('affiliate.resolved', { provider: aff.provider, catalogId: product.id });
      if (affiliateUrl && affiliateUrl !== product.affiliateUrl) {
        product = await this.catalog.update(product.id, { affiliateUrl });
      }
    }

    const status: VerificationStatus = product.verificationStatus;
    const result: ResolveDraftResult = {
      draftId: draft.draftId,
      resolutionStatus: status === 'UNRESOLVED' ? 'UNRESOLVED' : status,
      catalogProductId: product.id,
      merchantUrl,
      affiliateUrl,
      aiConfidence,
      matchConfidence: matchScore,
      decision,
      reason,
      enqueueBackground: false,
      specificityScore: quality.specificityScore,
      pdpClassifierScore: quality.pdpClassifierScore,
    };
    const provenance = product.metadata.field_provenance;
    emitPiEvent('verification.decided', {
      draftId: draft.draftId,
      catalogId: product.id,
      finalStatus: status,
      decision,
      reason: reason.slice(0, 240),
      specificityScore: quality.specificityScore,
      pdpClassifierScore: quality.pdpClassifierScore,
      matchScore,
      metadataSourceMap: provenance ? JSON.stringify(provenance).slice(0, 500) : null,
    });
    await this.persistDraft(result, product);
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

  private async persistDraft(result: ResolveDraftResult, product?: CatalogProduct): Promise<void> {
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
      displayProvider: product?.merchant,
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
