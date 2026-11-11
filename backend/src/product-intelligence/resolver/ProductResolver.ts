import type {CountryOfferService} from '../../shopping/CountryOfferService';
import {catalogShoppingSource} from '../../shopping/storedDestinations';
import {countrySuitability} from '../../shopping/countrySuitability';
import { privateImageContext } from '../../user-import/media/privacy';
import { assessMerchantIdentity, candidateEvidence, qualifyMerchantEvidenceSet, merchantOfferCandidate, MERCHANT_EVIDENCE_VERSION } from '../verification/merchantEvidence';
import { pdpSearchHintsAls, getPdpSearchHints, userIdentityExpectation } from '../search/pdpSearchHints';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProductIntelligenceConfig } from '../config';
import type {
  AiDraftInput,
  CatalogProduct,
  CreateCatalogInput,
  DiscoveredProductDraft,
  NormalizedProduct,
  ResolveDraftResult,
  ResolveIngestOptions,
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
import { resolvePersistableCategory } from '../domain/categoryTaxonomy';
import { emitPiEvent } from '../observability';
import {
  scoreProductSpecificity,
  textSupportsProductLine,
  userSearchLineTokens,
} from '../specificity/ProductSpecificityScorer';
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
import { ingestLog } from '../../pipeline/ingestLog';
import type { CatalogService } from '../../catalog/CatalogService';
import {
  isQualifyingMerchantSeedUrl,
  merchantUrlsMatch,
} from '../search/directUrlIdentity';
import { pickOneOfferPerMerchant } from '../search/merchantOfferDedupe';
import { resolveDiscoveryCountry } from '../search/discoveryCountry';
import { discoveredProductIdentityKey } from '../discovered/identity';
import {
  isProductIdentityCompatible,
} from '../search/productIdentityCompatibility';

function aiFieldProvenance(provider = 'ai'): Record<string, { source: string; provider?: string }> {
  return {
    title: { source: 'ai', provider },
    brand: { source: 'ai', provider },
    price: { source: 'ai', provider },
    heroImage: { source: 'ai', provider },
  };
}

function identityExpectation(norm: NormalizedProduct) {
  return {
    variantContext: getPdpSearchHints().variantContext,
    gtin: getPdpSearchHints().gtin,
    mpn: getPdpSearchHints().mpn,
    brand: norm.brand,
    name: norm.name,
    model: norm.model,
    category: norm.category === 'unknown' ? null : norm.category,
  };
}

function candidateMatchesIdentity(
  norm: NormalizedProduct,
  candidate: SearchCandidate,
  lineTokens: string[] = [],
): boolean {
  if (
    !isProductIdentityCompatible(identityExpectation(norm), {
      title: candidate.title,
      brand: candidate.brand,
      model: candidate.model,
      variantContext: candidate.variantContext,
      gtin: candidate.gtin,
      mpn: candidate.mpn,
      merchantUrl: candidate.merchantUrl,
      category: candidate.category,
    })
  ) {
    return false;
  }
  return textSupportsProductLine(lineTokens, [
    candidate.title,
    candidate.brand,
    candidate.model,
    candidate.merchantUrl,
  ]);
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
    private readonly countryOffers?:CountryOfferService,
  ) {}

  async resolveIngest(
    drafts: AiDraftInput[],
    opts: ResolveIngestOptions = {},
  ): Promise<ResolveDraftResult[]> {
    const promoteOnMiss = opts.promoteOnMiss !== false;
    const out: ResolveDraftResult[] = [];
    for (const d of drafts) {
      out.push(await pdpSearchHintsAls.run(userIdentityExpectation(d), () => this.resolveOne(d, promoteOnMiss, opts.onSearchCandidates)));
    }
    return out;
  }

  /**
   * User-import resolve: same matcher/enrichment, no catalog write on miss.
   */
  async resolveForUserImport(drafts: AiDraftInput[], onSearchCandidates?: ResolveIngestOptions['onSearchCandidates']): Promise<ResolveDraftResult[]> {
    return this.resolveIngest(drafts, { promoteOnMiss: false, onSearchCandidates });
  }

  private async resolveOne(
    draft: AiDraftInput,
    promoteOnMiss = true,
    onSearchCandidates?: ResolveIngestOptions['onSearchCandidates'],
  ): Promise<ResolveDraftResult> {
    const norm = this.normalizer.normalize(draft);
    const specificity = scoreProductSpecificity(draft, norm, this.cfg.specificityMin);
    // Creator keeps the score gate. User search may also proceed for a brand
    // plus a distinctive line, then the same identity gate decides attachment.
    const lineTokens = promoteOnMiss ? [] : userSearchLineTokens(specificity, norm);
    const maySearch = specificity.decision === 'searchable' || lineTokens.length > 0;
    const reasons = lineTokens.length
      ? [...specificity.reasons, 'brand_backed_distinctive_line']
      : specificity.reasons;
    const t0 = performance.now();
    emitPiEvent('specificity.assessed', {
      draftId: draft.draftId,
      specificityScore: specificity.score,
      threshold: this.cfg.specificityMin,
      decision: maySearch ? 'searchable' : specificity.decision,
      reason: reasons.join(','),
    });

    if (!maySearch) {
      const decision = 'insufficient_specificity';
      const reason = reasons.join(',');
      const result = await this.writeMiss(promoteOnMiss, draft, norm, decision, reason, 0, {
        specificityScore: specificity.score,
        pdpClassifierScore: null,
      }, {
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
        catalogId: result.catalogProductId,
        specificityScore: specificity.score,
        reason,
      });
      return result;
    }

    const localHit = await this.catalog.localSearch(norm);
    const localIdentityOk =
      !localHit ||
      (isProductIdentityCompatible(identityExpectation(norm), {
        title: localHit.product.name,
        brand: localHit.product.brand,
        model: localHit.product.model,
        merchantUrl: localHit.product.merchantUrl,
        category: localHit.product.category,
      }, { requireBrandSupport: !promoteOnMiss }) &&
        textSupportsProductLine(lineTokens, [
          localHit.product.name,
          localHit.product.brand,
          localHit.product.model,
          localHit.product.merchantUrl,
        ]));
    if (
      localHit &&
      localIdentityOk &&
      localHit.score >= this.cfg.catalogHitMinScore &&
      localHit.product.verificationStatus === 'VERIFIED'
    ) {
      emitPiEvent('catalog.hit', {
        draftId: draft.draftId,
        via: localHit.via,
        score: localHit.score,
      });
      // Requalify shopping only; a catalogue hit must never trigger fresh image enrichment.
      let cached = localHit.product;
      if(this.countryOffers) {
        const metadata=await this.countryOffers.resolve({...cached,kind:'catalog',source:catalogShoppingSource(cached)},draft.commerceCountry);
        cached={...cached,metadata};
      }
      const stored = cached.metadata.merchant_evidence_version === MERCHANT_EVIDENCE_VERSION && Array.isArray(cached.metadata.merchant_evidence)
        ? cached.metadata.merchant_evidence as import('../verification/merchantEvidence').MerchantEvidenceInput[] : [];
      const regional = cached.metadata.shopping_country_offers && typeof cached.metadata.shopping_country_offers==='object'
        ? Object.values(cached.metadata.shopping_country_offers).flatMap((row:any)=>Array.isArray(row?.evidence)?row.evidence:[]) : [];
      const fresh = this.countryOffers || stored.length || !this.search.discoverMerchantEvidence ? []
        : await this.search.discoverMerchantEvidence(buildProductSearchQuery(draft, norm, { merchantOnly: true }).query, resolveDiscoveryCountry(draft.commerceCountry)).catch(() => []);
      const evidence = qualifyMerchantEvidenceSet(identityExpectation(norm), [...stored,...regional, ...fresh], { requirePage: privateImageContext.getStore() === true });
      const accepted = evidence.filter(e => e.usable && (!privateImageContext.getStore() || e.state === 'PAGE_VERIFIED')).sort((a,b)=>countrySuitability(a.url,draft.commerceCountry,a.countryAvailability)-countrySuitability(b.url,draft.commerceCountry,b.countryAvailability));
      const url = accepted[0]?.url ?? null;
      const hit: CatalogProduct = { ...cached, merchantUrl: url, preferredShoppingUrl: url, affiliateUrl: null,
        verificationStatus: cached.verificationStatus, metadata: { ...cached.metadata,
          merchant_price_unverified: !merchantUrlsMatch(url, cached.merchantUrl),
          merchant_evidence_version: MERCHANT_EVIDENCE_VERSION, merchant_evidence: evidence,
          merchant_requires_page_evidence: privateImageContext.getStore() === true,
          offer: null, shopping_candidates: accepted.map(e => ({ url: e.url, merchantEvidence: e, countryAvailability:e.countryAvailability })) } };
      const localProduct = promoteOnMiss
        ? await this.catalog.createOrUpdateFromResolve(hit.id, {
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
            verificationStatus: hit.verificationStatus,
            verificationProvider: hit.verificationProvider ?? 'catalog',
            verificationSource: 'catalog',
            verificationVersion: this.cfg.verificationVersion,
            aiConfidence: hit.aiConfidence,
            matchConfidence: localHit.score,
            verificationConfidence: hit.verificationConfidence,
            metadata: {
              ...hit.metadata,
              merchant_evidence_version: MERCHANT_EVIDENCE_VERSION,
              merchant_evidence: evidence,
              merchant_price_unverified: !merchantUrlsMatch(url, cached.merchantUrl),
              merchant_requires_page_evidence: privateImageContext.getStore() === true,
              shopping_candidates: accepted.map(e => ({ url: e.url, merchantEvidence: e, countryAvailability:e.countryAvailability })),
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
                status: hit.verificationStatus,
                evidenceState: accepted.find(e => merchantUrlsMatch(e.url, url))?.state ?? 'UNRESOLVED',
                source: 'catalog',
                version: this.cfg.verificationVersion,
              },
            },
          })
        : hit;
      return this.finishWithCatalog(
        draft,
        norm.aiConfidence,
        localProduct,
        localHit.score,
        'local_hit',
        localHit.via,
        { specificityScore: specificity.score, pdpClassifierScore: null },
        { persistDraft: promoteOnMiss },
      );
    }

    emitPiEvent('catalog.miss', { draftId: draft.draftId });
    const builtQuery = buildProductSearchQuery(draft, norm);
    const merchantQuery = buildProductSearchQuery(draft, norm, { merchantOnly: true });
    emitPiEvent('search.query_built', {
      draftId: draft.draftId,
      query: builtQuery.query.slice(0, 240),
      reason: builtQuery.reasons.join(','),
      specificityScore: specificity.score,
    });
    // Creator path: any creatorSuppliedUrl is a seed and may skip discovery when strong.
    // User-import: only qualifying merchant PDPs are seeds; affiliate/social redirects never
    // suppress Serper. Discovery always runs for user-import (skipDiscoveryIfSeedStrong=false).
    const rawCreatorUrl = draft.creatorSuppliedUrl ? draft.merchantUrl ?? null : null;
    const creatorUrl =
      rawCreatorUrl &&
      (promoteOnMiss || isQualifyingMerchantSeedUrl(rawCreatorUrl))
        ? rawCreatorUrl
        : null;
    const userImportCountry = !promoteOnMiss
      ? resolveDiscoveryCountry(draft.commerceCountry)
      : null;
    const userImportHints = promoteOnMiss
      ? {}
      : {
          enrichAllCommerce: true,
          maxAdditionalMerchantOffers: this.cfg.userImportMaxAdditionalMerchantOffers,
          lightweightAdditionalMerchants: true,
          commerceCountry: userImportCountry,
        };
    const searchResult = await this.search.search(
      builtQuery.query,
      creatorUrl
        ? {
            seedMerchantUrl: creatorUrl,
            // Creator may skip Serper when the seed PDP is strong; user-import never skips.
            skipDiscoveryIfSeedStrong: promoteOnMiss,
            ...userImportHints,
          }
        : promoteOnMiss
          ? undefined
          : userImportHints,
    );

    const merchantCountry = resolveDiscoveryCountry(draft.commerceCountry);
    const missingIdentityTokens = merchantQuery.terms.some(term => !builtQuery.terms.some(old => old.toLowerCase() === term.toLowerCase()));
    const regionalEvidence = searchResult.kind === 'Succeeded' && this.search.discoverMerchantEvidence
      && (missingIdentityTokens || (promoteOnMiss && !qualifyMerchantEvidenceSet(identityExpectation(norm),
        searchResult.merchantEvidence??searchResult.candidates.map(candidateEvidence)).some(e=>e.usable&&countrySuitability(e.url,merchantCountry,e.countryAvailability)===0)))
      ? await this.search.discoverMerchantEvidence(merchantQuery.query, merchantCountry, { includeBase: missingIdentityTokens }).catch(() => [])
      : [];
    const merchantEvidence = searchResult.kind === 'Succeeded'
      ? qualifyMerchantEvidenceSet(identityExpectation(norm), [...(searchResult.merchantEvidence ?? searchResult.candidates.map(candidateEvidence)), ...regionalEvidence], { requirePage: privateImageContext.getStore() === true })
      : [];
    const acceptedEvidence = merchantEvidence.filter(e => e.usable && (!privateImageContext.getStore() || e.state === 'PAGE_VERIFIED'));
    ingestLog('info', 'merchant.qualification.completed', { draftId: draft.draftId, country: merchantCountry,
      acceptedCount: acceptedEvidence.length, candidateCount: merchantEvidence.length, version: MERCHANT_EVIDENCE_VERSION,
      durationMs: Math.round(performance.now() - t0),
      firstUsableBuyUrlMs: acceptedEvidence.length ? Math.round(performance.now() - t0) : null,
      pageVerifiedCount: merchantEvidence.filter(e => e.state === 'PAGE_VERIFIED').length,
      discoveryVerifiedCount: merchantEvidence.filter(e => e.state === 'DISCOVERY_VERIFIED').length,
      // No URLs, snippets, source text or account data in rejection diagnostics.
      rejectionReasons: JSON.stringify(merchantEvidence.filter(e => !e.usable).reduce<Record<string, number>>((counts, e) => {
        counts[e.reason] = (counts[e.reason] ?? 0) + 1; return counts;
      }, {})) });
    if (!promoteOnMiss && searchResult.kind === 'Succeeded') onSearchCandidates?.(draft.draftId, searchResult.candidates);
    if (searchResult.kind === 'Failed') {
      emitPiEvent('search.failed', {
        draftId: draft.draftId,
        errorKind: searchResult.errorKind,
        durationMs: Math.round(performance.now() - t0),
      });
      // Creator: persist UNRESOLVED so UI never depends on providers.
      // User import: discovered payload, never a catalog placeholder.
      const result = await this.writeMiss(promoteOnMiss, draft, norm, 'unresolved_search_failed', `${searchResult.errorKind}: ${searchResult.message}`, 0, {
        specificityScore: specificity.score,
        pdpClassifierScore: null,
      }, {
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
        verificationStatus: 'UNRESOLVED',
        verificationSource: 'search_failed',
        verificationVersion: this.cfg.verificationVersion,
        aiConfidence: norm.aiConfidence,
        matchConfidence: null,
        verificationConfidence: 0,
        aliases: norm.aliases,
        metadata: {
          merchant_evidence_version: MERCHANT_EVIDENCE_VERSION,
          merchant_evidence: merchantEvidence,
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
      emitPiEvent('draft.unresolved', { draftId: draft.draftId, catalogId: result.catalogProductId });
      if (promoteOnMiss && this.background && this.cfg.backgroundResolve) {
        await this.background.enqueue({ draftId: draft.draftId, ingestId: this.ingestId });
        emitPiEvent('resolve.background_enqueued', { draftId: draft.draftId });
      }
      return { ...result, enqueueBackground: promoteOnMiss };
    }

    if (searchResult.candidates.length === 0 && !acceptedEvidence.length) {
      emitPiEvent('search.succeeded_empty', { draftId: draft.draftId });
      const result = await this.writeMiss(promoteOnMiss, draft, norm, 'created_unverified_empty_search', 'search succeeded with no acceptable PDP', 0.4, {
        specificityScore: specificity.score,
        pdpClassifierScore: null,
      }, {
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
          merchant_evidence_version: MERCHANT_EVIDENCE_VERSION,
          merchant_evidence: merchantEvidence,
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
      if (result.catalogProductId) {
        emitPiEvent('catalog.created_unverified', { catalogId: result.catalogProductId });
      }
      return result;
    }

    const imageCandidates = searchResult.candidates.filter(
      (c) =>
        c.enrichmentSucceeded === true &&
        candidateMatchesIdentity(norm, c, lineTokens) &&
        (Boolean(creatorUrl && merchantUrlsMatch(c.merchantUrl, creatorUrl)) ||
          this.scorer.score(norm, c).score >= this.cfg.verificationMatchMin),
    );
    const metadataCandidates = imageCandidates.filter(c =>
      c.title.trim().replace(/^www\./i, '').toLowerCase() !== sourceHost(c.merchantUrl) &&
      c.enrichmentMeta?.lightweight !== true &&
      c.enrichmentMeta?.enrichmentProvider !== 'discovery_url_only' &&
      assessMerchantIdentity(identityExpectation(norm), {
        title: c.title, brand: c.brand, model: c.model, merchantUrl: c.merchantUrl,
        category: c.category, variantContext: c.variantContext, gtin: c.gtin, mpn: c.mpn,
      }).ok);
    const commerceCandidatesRaw = acceptedEvidence.map(e => merchantOfferCandidate(e,
      searchResult.candidates.find(c => merchantUrlsMatch(c.merchantUrl, e.url)), norm.brand));
    // Canonical-equivalent merchant URLs only (different merchants selling the same
    // product are retained). Uses existing merchantUrlsMatch / normalizeMerchantUrl.
    const commerceCandidatesUrlDeduped: SearchCandidate[] = [];
    for (const candidate of commerceCandidatesRaw) {
      if (
        commerceCandidatesUrlDeduped.some((existing) =>
          merchantUrlsMatch(existing.merchantUrl, candidate.merchantUrl),
        )
      ) {
        continue;
      }
      commerceCandidatesUrlDeduped.push(candidate);
    }
    // Shared merchant policy: one qualified offer per merchant/domain, bounded by the existing offer limit.
    const commerceCandidates = pickOneOfferPerMerchant(commerceCandidatesUrlDeduped, merchantCountry)
      .slice(0, Math.max(1, this.cfg.userImportMaxAdditionalMerchantOffers) + (creatorUrl && acceptedEvidence.some(e => merchantUrlsMatch(e.url, creatorUrl)) ? 1 : 0));

    if (!imageCandidates.length && !commerceCandidates.length) {
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
              ? candidateMatchesIdentity(norm, candidate, lineTokens)
                ? 'below_match_threshold'
                : 'identity_incompatible'
              : 'enrichment_failed',
        });
      }
      const scoredBest = this.scorer.pickBest(
        norm,
        searchResult.candidates,
        this.cfg.verificationMatchMin,
      );
      emitPiEvent('search.succeeded_empty', { draftId: draft.draftId, reason: 'no_score' });
      const lowReason = scoredBest
        ? 'candidate failed PDP/enrichment verification policy'
        : 'candidates below match threshold';
      return this.writeMiss(promoteOnMiss, draft, norm, 'created_unverified_low_score', lowReason, 0.35, {
        specificityScore: specificity.score,
        pdpClassifierScore: scoredBest?.candidate.pdpScore ?? null,
      }, {
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
          merchant_evidence_version: MERCHANT_EVIDENCE_VERSION,
          merchant_evidence: merchantEvidence,
          source: 'ai_fallback_low_score',
          field_provenance: aiFieldProvenance(),
          scores: {
            specificity: specificity.score,
            pdpClassifier: scoredBest?.candidate.pdpScore ?? null,
            match: scoredBest?.match.score ?? null,
          },
          verification: {
            decision: 'created_unverified_low_score',
            reason: lowReason,
            status: 'UNVERIFIED',
            source: 'ai_fallback',
            version: this.cfg.verificationVersion,
          },
        },
      });
    }

    // Preserve the exact legacy image pool, merge, gallery order and fallback.
    const imageMerged = mergeEnrichedCandidates(imageCandidates);
    const merged = { ...mergeEnrichedCandidates(metadataCandidates), heroImage: imageMerged.heroImage, gallery: imageMerged.gallery };
    for (const field of ['heroImage', 'gallery'] as const) {
      if (imageMerged.metadataSourceMap[field]) merged.metadataSourceMap[field] = imageMerged.metadataSourceMap[field];
    }
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
        countryAvailability: c.enrichmentMeta?.countryAvailability as import('../../shopping/countrySuitability').CountryAvailability,
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
        countryAvailability: c.enrichmentMeta?.countryAvailability as import('../../shopping/countrySuitability').CountryAvailability,
        sourceTier: c.sourceTier,
        merchant: c.merchant,
        price: c.price,
        currency: c.currency,
        sourceType: c.sourceType,
        pageType: c.pageType,
        capabilities: c.capabilities,
        sourceAuthority: c.sourceAuthority,
        shoppingScore: c.shoppingScore,
        pdpScore: c.pdpScore,
        availability:
          typeof c.enrichmentMeta?.availability === 'string'
            ? c.enrichmentMeta.availability
            : null,
        affiliateSupported: false,
      })),
      shoppingResolvedSelection.merchantPriority,
      merchantCountry,
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
    let shopping =
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
    if (shopping) {
      const identityOffer = (url: string) =>
        commerceCandidates.some((candidate) => merchantUrlsMatch(candidate.merchantUrl, url));
      shopping = {
        ...shopping,
        offers: shopping.offers.filter((offer) => identityOffer(offer.url)),
      };
      if (!identityOffer(shopping.preferredShoppingUrl)) {
        const fallback = commerceCandidates.find((candidate) => candidate.merchantUrl)?.merchantUrl ?? null;
        shopping = fallback
          ? { ...shopping, preferredShoppingUrl: fallback, selectionSource: 'resolver' }
          : null;
      }
    }

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
              ? candidateMatchesIdentity(norm, candidate, lineTokens)
                ? 'below_match_threshold'
                : 'identity_incompatible'
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
    const bestMatch = matchScores.length ? matchScores.reduce((a, b) => (a.score >= b.score ? a : b)) : this.scorer.score(norm, { title: norm.name, merchant: null, merchantUrl: '', image: null, score: 0 });
    const bestPdpScore = Math.max(0, ...decisionCandidates.map((c) => c.pdpScore ?? 0));

    const seedCandidate =
      creatorUrl != null
        ? searchResult.candidates.find(
            (c) => c.enrichmentSucceeded && merchantUrlsMatch(c.merchantUrl, creatorUrl),
          ) ?? null
        : null;
    // Seed URLs need their own accepted evidence. Only the separate image lane retains the original seed fallback.
    const seedAccepted = seedCandidate != null && candidateMatchesIdentity(norm, seedCandidate, lineTokens);
    const legacyTrustSeed = Boolean(creatorUrl && seedCandidate && (promoteOnMiss || seedAccepted));
    const trustSeed = Boolean(creatorUrl && acceptedEvidence.some(e => merchantUrlsMatch(e.url, creatorUrl)));
    const trustSeedFacts = Boolean(trustSeed && seedCandidate?.enrichmentMeta?.merchantPageIdentity);
    const identityUrl =
      (trustSeed ? creatorUrl : null) ??
      shopping?.preferredShoppingUrl ??
      commerceCandidates.find((c) => c.merchantUrl)?.merchantUrl ??
      null;
    const identityCandidate = identityUrl
      ? commerceCandidates.find((candidate) => merchantUrlsMatch(candidate.merchantUrl, identityUrl)) ??
        null
      : null;
    const selectedEvidence = acceptedEvidence.find(e => merchantUrlsMatch(e.url, identityUrl));
    const selectedMatch = identityCandidate ? this.scorer.score(norm, identityCandidate) : bestMatch;
    const verificationStatus: VerificationStatus = selectedEvidence ? 'VERIFIED' : 'UNVERIFIED';
    const resolutionDecision = selectedEvidence ? 'created_verified' : 'created_unverified_low_score';
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
        source: field === 'heroImage' || field === 'gallery' ? 'merchant' : metadataCandidates.some(c => sourceHost(c.merchantUrl) === entry.source && c.enrichmentMeta?.merchantPageIdentity) ? 'merchant' : 'enrichment',
        provider: entry.source,
        confidence: entry.confidence,
        value: entry.value,
        metadataScore: entry.metadataScore,
        sourceType: entry.sourceType,
        pageType: entry.pageType,
        trustRank: entry.trustRank,
      };
    }

    const result = await this.writeMiss(promoteOnMiss, draft, norm, resolutionDecision, selectedEvidence?.reason ?? selectedMatch.reason, selectedMatch.score, {
      specificityScore: specificity.score,
      pdpClassifierScore: bestPdpScore,
    }, {
      name: (trustSeedFacts ? seedCandidate?.title : null) || merged.title || norm.name,
      normalizedName: norm.normalizedName,
      canonicalSlug: norm.canonicalSlugBase,
      brand: (trustSeedFacts ? seedCandidate?.brand : null) || merged.brand || norm.brand,
      model: merged.model ?? norm.model,
      category: resolvePersistableCategory(merged.category, norm.category),
      description: merged.description ?? (trustSeedFacts ? seedCandidate?.description ?? null : null),
      imageUrl: imageCandidates.length ? merged.heroImage ?? (legacyTrustSeed ? seedCandidate?.image ?? null : null) ?? norm.imageHint : norm.imageHint,
      merchant:
        (trustSeed ? seedCandidate?.merchant : null) ??
        merged.offer?.merchant ??
        verification?.merchant ??
        null,
      merchantUrl: (trustSeed ? creatorUrl : null) ?? (merged.offer && commerceCandidates.some(c => merchantUrlsMatch(c.merchantUrl, merged.offer!.merchantUrl)) ? merged.offer.merchantUrl : null) ?? identityUrl,
      preferredShoppingUrl: shopping?.preferredShoppingUrl ?? (trustSeed ? creatorUrl : null) ?? null,
      affiliateUrl: merged.offer && commerceCandidates.some(c => merchantUrlsMatch(c.merchantUrl, merged.offer!.merchantUrl)) ? merged.offer.affiliateUrl : null,
      shoppingProvider: shopping?.shoppingProvider ?? null,
      price: merged.offer?.price ?? null,
      currency: merged.offer?.currency ?? null,
      verificationStatus,
      verificationSource: searchResult.provider,
      verificationProvider: searchResult.provider,
      verificationVersion: this.cfg.verificationVersion,
      aiConfidence: norm.aiConfidence,
      matchConfidence: selectedMatch.matchConfidence,
      verificationConfidence: Math.min(
        1,
        selectedMatch.score,
      ),
      aliases: norm.aliases,
      metadata: {
        source: searchResult.provider,
        merchant_evidence_version: MERCHANT_EVIDENCE_VERSION,
        merchant_evidence: merchantEvidence,
        merchant_requires_page_evidence: privateImageContext.getStore() === true,
        image_identity_review_required: imageCandidates.filter(c => c.image === imageMerged.heroImage
          && !assessMerchantIdentity(identityExpectation(norm), { title: c.title, brand: c.brand, model: c.model, merchantUrl: c.merchantUrl }).ok).map(c => c.merchantUrl),
        ...(merged.description ? { description: merged.description } : {}),
        ...(merged.shortDescription ? { short_description: merged.shortDescription } : {}),
        specifications: merged.specifications,
        gallery: merged.gallery,
        primary_image: merged.heroImage,
        availability: merged.availability,
        offer: merged.offer && commerceCandidates.some(c => merchantUrlsMatch(c.merchantUrl, merged.offer!.merchantUrl)) ? merged.offer : null,
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
        shopping_candidates: shopping?.offers.map(offer => ({ ...offer, countryAvailability:acceptedEvidence.find(e=>merchantUrlsMatch(e.url,offer.url))?.countryAvailability, merchantEvidence: acceptedEvidence.find(e => merchantUrlsMatch(e.url, offer.url)) })) ?? [],
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
          reason: selectedEvidence?.reason ?? selectedMatch.reason,
          status: verificationStatus,
          evidenceState: selectedEvidence?.state ?? 'UNRESOLVED',
          identityPath: 'per_offer',
          source: searchResult.provider,
          sourceTier: verification?.sourceTier ?? 'retailer',
          version: this.cfg.verificationVersion,
        },
      },
    });
    if (result.catalogProductId) {
      emitPiEvent(
        verificationStatus === 'VERIFIED'
          ? 'catalog.created_verified'
          : 'catalog.created_unverified',
        { catalogId: result.catalogProductId },
      );
    }
    return result;
  }

  /**
   * Creator promote-on-miss writes catalog; user import returns a discovered payload instead.
   */
  private async writeMiss(
    promoteOnMiss: boolean,
    draft: AiDraftInput,
    norm: NormalizedProduct,
    decision: string,
    reason: string,
    matchScore: number,
    quality: { specificityScore: number; pdpClassifierScore: number | null },
    catalogInput: CreateCatalogInput,
  ): Promise<ResolveDraftResult> {
    // Every new resolution is versioned, including empty/error/specificity outcomes.
    // Missing evidence must never expose an old preferred URL after an in-place update.
    catalogInput = { ...catalogInput, preferredShoppingUrl: catalogInput.preferredShoppingUrl ?? null,
      metadata: { ...catalogInput.metadata, merchant_evidence_version: MERCHANT_EVIDENCE_VERSION,
        merchant_evidence: catalogInput.metadata?.merchant_evidence ?? [],
        merchant_requires_page_evidence: privateImageContext.getStore() === true } };
    if (!promoteOnMiss) {
      return this.finishAsDiscovered(draft, norm, decision, reason, matchScore, quality, catalogInput);
    }
    const created = await this.upsertCatalog(draft.catalogProductId, catalogInput);
    return this.finishWithCatalog(
      draft,
      norm.aiConfidence,
      created,
      matchScore,
      decision,
      reason,
      quality,
    );
  }

  private finishAsDiscovered(
    draft: AiDraftInput,
    norm: NormalizedProduct,
    decision: string,
    reason: string,
    matchScore: number,
    quality: { specificityScore: number; pdpClassifierScore: number | null },
    catalogInput: CreateCatalogInput,
  ): ResolveDraftResult {
    const merchantUrl = catalogInput.merchantUrl !== undefined ? catalogInput.merchantUrl : norm.merchantUrlHint ?? null;
    const completeness =
      typeof catalogInput.metadata?.metadata_completeness === 'number'
        ? catalogInput.metadata.metadata_completeness
        : typeof catalogInput.metadata?.metadataCompleteness === 'number'
          ? catalogInput.metadata.metadataCompleteness
          : null;
    const discovered: DiscoveredProductDraft = {
      name: catalogInput.name,
      brand: catalogInput.brand ?? null,
      model: catalogInput.model ?? null,
      category: resolvePersistableCategory(catalogInput.category) ?? null,
      imageUrl: catalogInput.imageUrl ?? null,
      price: catalogInput.price ?? null,
      currency: catalogInput.currency ?? null,
      merchant: catalogInput.merchant ?? null,
      merchantUrl,
      identityKey: discoveredProductIdentityKey(norm, merchantUrl),
      metadata: catalogInput.metadata ?? {},
      matchConfidence: matchScore,
      completeness,
    };
    emitPiEvent('catalog.miss', {
      draftId: draft.draftId,
      decision,
      promoteOnMiss: false,
    });
    return {
      draftId: draft.draftId,
      resolutionStatus: catalogInput.verificationStatus,
      catalogProductId: null,
      merchantUrl,
      affiliateUrl: null,
      aiConfidence: norm.aiConfidence,
      matchConfidence: matchScore,
      decision,
      reason,
      enqueueBackground: false,
      specificityScore: quality.specificityScore,
      pdpClassifierScore: quality.pdpClassifierScore,
      discovered,
    };
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
    opts: { persistDraft?: boolean } = {},
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
    const persistDraft = opts.persistDraft !== false;
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
    if (persistDraft) {
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
    }
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
