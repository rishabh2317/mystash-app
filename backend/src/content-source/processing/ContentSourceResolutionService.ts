import type { CartService } from '../../cart/CartService';
import { getPipelineConfig } from '../../config/pipelineConfig';
import { getProductIntelligenceConfig } from '../../product-intelligence/config';
import type { DiscoveredProductService } from '../../discovered/DiscoveredProductService';
import { logger } from '../../logger';
import { resolveCountryCode } from '../../merchant-pricing/country';
import type { AiDraftInput, CatalogProduct, ResolveDraftResult } from '../../product-intelligence/domain/types';
import { ProductNormalizer } from '../../product-intelligence/normalizer/ProductNormalizer';
import {
  scoreProductSpecificity,
  textSupportsProductLine,
  userSearchLineTokens,
} from '../../product-intelligence/specificity/ProductSpecificityScorer';
import type { DiscoveredProductRecord } from '../../discovered/domain/types';
import { resolvePersistableCategory } from '../../product-intelligence/domain/categoryTaxonomy';
import {
  isAffiliateOrSocialRedirectUrl,
  isQualifyingMerchantSeedUrl,
} from '../../product-intelligence/search/directUrlIdentity';
import { assessProductIdentityCompatibility } from '../../product-intelligence/search/productIdentityCompatibility';
import {
  pdpSearchHintsAls,
  userIdentityExpectation,
} from '../../product-intelligence/search/pdpSearchHints';
import type { ContentSourceRepository } from '../ContentSourceRepository';
import type { ContentSourceProductRecord } from '../domain/types';
import { enqueueContentSourceEnrichment } from '../jobs/contentSourceQueue';
import type { UserCommerceCountryPort, UserImportLookupPort } from '../ports';
import { hypothesisMayResolve, isAttachableUserDecision } from './userAttachPolicy';

const lineNormalizer = new ProductNormalizer();

function httpImageUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function lineTokensForDraft(draft: AiDraftInput): string[] {
  const norm = lineNormalizer.normalize(draft);
  const specificity = scoreProductSpecificity(
    draft,
    norm,
    getProductIntelligenceConfig().specificityMin,
  );
  return userSearchLineTokens(specificity, norm);
}

export type UserImportResolvePort = {
  resolveForUserImport(drafts: AiDraftInput[]): Promise<ResolveDraftResult[]>;
  getCatalogProduct?(id: string): Promise<CatalogProduct | null>;
};

/**
 * User-import resolution. The only Stash write is `attachValidatedBagLine`.
 * A candidate stays unbound until identity validation produces an attachable decision.
 */
export class ContentSourceResolutionService {
  constructor(
    private readonly sources: ContentSourceRepository,
    private readonly discovered: DiscoveredProductService,
    private readonly resolver: UserImportResolvePort,
    private readonly userImports: UserImportLookupPort,
    private readonly cart: CartService,
    private readonly userCountry: UserCommerceCountryPort | null = null,
  ) {}

  /**
   * Resolve every unbound candidate, persist only attachable outcomes, then
   * fan already-bound products into each importer's Bag.
   * Returns the number of bound products.
   */
  async resolveAndFanOut(contentSourceId: string, userImportId?: string): Promise<number> {
    await this.validateAndAttach(contentSourceId, userImportId);
    await this.fanOutAll(contentSourceId);
    const products = await this.sources.listProducts(contentSourceId);
    return products.filter((product) => product.catalogProductId || product.discoveredProductId).length;
  }

  /** Queue PI merchant enrichment for an already-attached discovered product. */
  async enqueueMerchantEnrichment(
    contentSourceId: string,
    userImportId: string,
    traceId?: string,
  ): Promise<void> {
    const products = await this.sources.listProducts(contentSourceId);
    for (const product of products) {
      if (!product.discoveredProductId) continue;
      try {
        await enqueueContentSourceEnrichment({
          contentSourceId,
          contentSourceProductId: product.id,
          discoveredProductId: product.discoveredProductId,
          userImportId,
          traceId,
        });
      } catch (err) {
        logger.warn(
          { err, contentSourceId, discoveredProductId: product.discoveredProductId },
          'content_source.enrich.enqueue_failed',
        );
      }
    }
  }

  /**
   * In-place update of a discovered product that was already attached.
   * A rejected or weak result does not overwrite the row and does not insert one.
   */
  async enrichDiscoveredProduct(input: {
    contentSourceId: string;
    contentSourceProductId: string;
    discoveredProductId: string;
    userImportId?: string;
    commerceCountry?: string | null;
  }): Promise<void> {
    const product = (await this.sources.listProducts(input.contentSourceId)).find(
      (row) => row.id === input.contentSourceProductId,
    );
    if (!product || product.discoveredProductId !== input.discoveredProductId) return;
    if (!hypothesisMayResolve(product)) return;

    const draft = await this.draftForResolve(product, input.userImportId, input.commerceCountry);
    const lineTokens = lineTokensForDraft(draft);
    const result = await this.resolveDraft(draft);
    if (!result?.discovered || !isAttachableUserDecision(result.decision)) return;
    const expectation = userIdentityExpectation(draft);
    if (!discoveredDraftMatchesExpectation(result.discovered, expectation, lineTokens)) return;

    const processorVersion = getPipelineConfig().pipelineVersion;
    await this.discovered.applyEnrichment(
      input.discoveredProductId,
      {
        ...result.discovered,
        category:
          resolvePersistableCategory(result.discovered.category, product.category) ??
          result.discovered.category,
      },
      processorVersion,
    );
  }

  private async validateAndAttach(contentSourceId: string, userImportId?: string): Promise<void> {
    const source = await this.sources.findById(contentSourceId);
    if (!source) return;
    const products = await this.sources.listProducts(source.id);
    const processorVersion = getPipelineConfig().pipelineVersion;
    const imports = await this.userImports.listByContentSourceId(contentSourceId);
    const countryImportId = userImportId ?? imports[0]?.id;

    for (const product of products) {
      const draft = await this.draftForResolve(product, countryImportId, null);
      const expectation = userIdentityExpectation(draft);
      const lineTokens = lineTokensForDraft(draft);
      if (!hypothesisMayResolve(product)) {
        if (product.catalogProductId || product.discoveredProductId) {
          await this.sources.bindProductResolution(product.id, {
            catalogProductId: null,
            discoveredProductId: null,
          });
        }
        continue;
      }

      if (product.catalogProductId) {
        const catalogOk = await this.catalogHitMatchesExpectation(
          product.catalogProductId,
          expectation,
          lineTokens,
        );
        if (catalogOk) {
          await this.copyBoundImage(
            product,
            (await this.resolver.getCatalogProduct?.(product.catalogProductId))?.imageUrl,
          );
          continue;
        }
        await this.sources.bindProductResolution(product.id, {
          catalogProductId: null,
          discoveredProductId: null,
        });
      } else if (product.discoveredProductId) {
        const discoveredOk = await this.discoveredMatchesExpectation(
          product.discoveredProductId,
          expectation,
          lineTokens,
        );
        if (discoveredOk) {
          const record = await this.discovered.getById(product.discoveredProductId);
          await this.copyBoundImage(product, record?.imageUrl);
          continue;
        }
        await this.sources.bindProductResolution(product.id, {
          catalogProductId: null,
          discoveredProductId: null,
        });
      }

      const result = await this.resolveDraft(draft);
      if (!result || !isAttachableUserDecision(result.decision)) continue;

      if (result.catalogProductId) {
        const catalogOk = await this.catalogHitMatchesExpectation(
          result.catalogProductId,
          expectation,
          lineTokens,
        );
        if (!catalogOk) continue;
        const catalog = await this.resolver.getCatalogProduct?.(result.catalogProductId);
        await this.sources.bindProductResolution(product.id, {
          catalogProductId: result.catalogProductId,
          discoveredProductId: null,
          image: httpImageUrl(product.image) ?? httpImageUrl(catalog?.imageUrl),
        });
        continue;
      }

      if (!result.discovered || !discoveredDraftMatchesExpectation(result.discovered, expectation, lineTokens)) continue;
      const saved = await this.discovered.getOrCreate(result.discovered, processorVersion);
      if (!discoveredRecordMatchesExpectation(saved.record, expectation, lineTokens)) continue;
      await this.sources.bindProductResolution(product.id, {
        catalogProductId: null,
        discoveredProductId: saved.record.id,
        image: httpImageUrl(product.image) ?? httpImageUrl(saved.record.imageUrl),
      });
    }
  }

  private async copyBoundImage(
    product: ContentSourceProductRecord,
    fallback: string | null | undefined,
  ): Promise<void> {
    if (httpImageUrl(product.image)) return;
    const image = httpImageUrl(fallback);
    if (!image) return;
    await this.sources.bindProductResolution(product.id, {
      catalogProductId: product.catalogProductId,
      discoveredProductId: product.discoveredProductId,
      image,
    });
  }

  private async resolveDraft(draft: AiDraftInput): Promise<ResolveDraftResult | undefined> {
    const expectation = userIdentityExpectation(draft);
    const [result] = await pdpSearchHintsAls.run(expectation, () =>
      this.resolver.resolveForUserImport([draft]),
    );
    return result;
  }

  private async draftForResolve(
    product: ContentSourceProductRecord,
    userImportId?: string,
    commerceCountry?: string | null,
  ): Promise<AiDraftInput> {
    const draft = toDraft(product);
    draft.commerceCountry = await this.resolveCommerceCountry({
      userImportId,
      commerceCountry,
    });
    const rawMerchantUrl = product.merchantUrl?.startsWith('http') ? product.merchantUrl : null;
    if (rawMerchantUrl && isQualifyingMerchantSeedUrl(rawMerchantUrl)) {
      draft.creatorSuppliedUrl = true;
    } else if (rawMerchantUrl && isAffiliateOrSocialRedirectUrl(rawMerchantUrl)) {
      logger.info(
        {
          contentSourceProductId: product.id,
          host: (() => {
            try {
              return new URL(rawMerchantUrl).hostname.replace(/^www\./i, '');
            } catch {
              return null;
            }
          })(),
          skippedDiscovery: false,
          reason: 'affiliate_or_social_redirect_not_seed',
        },
        'merchant_discovery.seed_rejected',
      );
    }
    return draft;
  }

  private async catalogHitMatchesExpectation(
    catalogProductId: string,
    expectation: ReturnType<typeof userIdentityExpectation>,
    lineTokens: string[] = [],
  ): Promise<boolean> {
    const product = await this.resolver.getCatalogProduct?.(catalogProductId);
    if (!product || product.verificationStatus !== 'VERIFIED') return false;
    const identityOk = assessProductIdentityCompatibility(expectation, {
      title: product.name,
      brand: product.brand,
      model: product.model,
      merchantUrl: product.merchantUrl,
      category: product.category,
    }).ok;
    if (!identityOk) return false;
    if (
      !textSupportsProductLine(lineTokens, [
        product.name,
        product.brand,
        product.model,
        product.merchantUrl,
      ])
    ) {
      return false;
    }
    return !buyUrlContradictsExpectation(expectation, product.preferredShoppingUrl);
  }

  private async discoveredMatchesExpectation(
    discoveredProductId: string,
    expectation: ReturnType<typeof userIdentityExpectation>,
    lineTokens: string[] = [],
  ): Promise<boolean> {
    const record = await this.discovered.getById(discoveredProductId);
    if (!record) return false;
    return discoveredRecordMatchesExpectation(record, expectation, lineTokens);
  }

  private async resolveCommerceCountry(input: {
    userImportId?: string;
    commerceCountry?: string | null;
  }): Promise<string> {
    if (input.commerceCountry) {
      return resolveCountryCode({ profile: input.commerceCountry });
    }
    if (input.userImportId && this.userImports.findById && this.userCountry) {
      const row = await this.userImports.findById(input.userImportId);
      if (row?.userId) {
        const profile = await this.userCountry.getCommerceCountry(row.userId);
        return resolveCountryCode({ profile });
      }
    }
    return resolveCountryCode({});
  }

  async fanOutAll(contentSourceId: string): Promise<void> {
    const imports = await this.userImports.listByContentSourceId(contentSourceId);
    for (const row of imports) {
      await this.fanOutUser({
        id: row.id,
        userId: row.userId,
        contentSourceId,
      });
    }
  }

  async fanOutUser(row: {
    id: string;
    userId: string;
    contentSourceId: string | null;
  }): Promise<void> {
    if (!row.contentSourceId || !row.userId) return;
    const products = await this.sources.listProducts(row.contentSourceId);
    for (const product of products) {
      await this.attachValidatedBagLine(row, product);
    }
  }

  /**
   * The only User-import call to CartService.addItem.
   * Unbound candidates, including rejected seeds and AI fallbacks, are skipped.
   */
  private async attachValidatedBagLine(
    row: { id: string; userId: string; contentSourceId: string | null },
    product: ContentSourceProductRecord,
  ): Promise<void> {
    const item = product.catalogProductId
      ? { catalogProductId: product.catalogProductId }
      : product.discoveredProductId
        ? { discoveredProductId: product.discoveredProductId }
        : null;
    if (!item || !row.userId) return;
    const draft = toDraft(product);
    const expectation = userIdentityExpectation(draft);
    const lineTokens = lineTokensForDraft(draft);
    if (product.catalogProductId) {
      const catalogOk = await this.catalogHitMatchesExpectation(
        product.catalogProductId,
        expectation,
        lineTokens,
      );
      if (!catalogOk) return;
    } else if (product.discoveredProductId) {
      const discoveredOk = await this.discoveredMatchesExpectation(
        product.discoveredProductId,
        expectation,
        lineTokens,
      );
      if (!discoveredOk) return;
    }
    try {
      await this.cart.addItem(row.userId, {
        ...item,
        source: {
          surface: 'USER_IMPORT',
          contentSourceId: row.contentSourceId,
          userImportId: row.id,
        },
      });
    } catch (err) {
      logger.warn(
        {
          err,
          userImportId: row.id,
          contentSourceId: row.contentSourceId,
          contentSourceProductId: product.id,
          catalogProductId: product.catalogProductId,
          discoveredProductId: product.discoveredProductId,
        },
        'content_source.bag.fan_out_failed',
      );
    }
  }
}

const BUY_URL_CONTRADICTIONS = new Set([
  'brand_conflict',
  'model_conflict',
  'color_conflict',
  'type_conflict',
]);

function pathTitle(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname).replace(/[/-]+/g, ' ');
  } catch {
    return '';
  }
}

/** A buy URL may omit the model (an ASIN). It may not name a different product. */
function buyUrlContradictsExpectation(
  expectation: ReturnType<typeof userIdentityExpectation>,
  url: string | null | undefined,
): boolean {
  if (!url) return false;
  const result = assessProductIdentityCompatibility(expectation, {
    title: pathTitle(url),
    merchantUrl: url,
  });
  return result.reason != null && BUY_URL_CONTRADICTIONS.has(result.reason);
}

function discoveredDraftMatchesExpectation(
  draft: { name: string; brand?: string | null; model?: string | null; category?: string | null; merchantUrl?: string | null },
  expectation: ReturnType<typeof userIdentityExpectation>,
  lineTokens: string[] = [],
): boolean {
  const identityOk = assessProductIdentityCompatibility(expectation, {
    title: draft.name,
    brand: draft.brand,
    model: draft.model,
    merchantUrl: draft.merchantUrl,
    category: draft.category,
  }).ok;
  return (
    identityOk &&
    textSupportsProductLine(lineTokens, [draft.name, draft.brand, draft.model, draft.merchantUrl]) &&
    !buyUrlContradictsExpectation(expectation, draft.merchantUrl)
  );
}

function discoveredRecordMatchesExpectation(
  record: DiscoveredProductRecord,
  expectation: ReturnType<typeof userIdentityExpectation>,
  lineTokens: string[] = [],
): boolean {
  return discoveredDraftMatchesExpectation(record, expectation, lineTokens);
}

function toDraft(product: ContentSourceProductRecord): AiDraftInput {
  return {
    draftId: product.id,
    externalId: product.externalId,
    name: product.name,
    brand: product.brand,
    model: product.model,
    category: resolvePersistableCategory(product.category) ?? product.category,
    confidence: product.confidence ?? 0.5,
    merchantUrl: product.merchantUrl,
    image: product.image,
    price: product.price,
    currency: product.currency,
    sources: product.sources,
    evidence: product.evidence,
  };
}
