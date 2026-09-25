import type { CartService } from '../../cart/CartService';
import { getPipelineConfig } from '../../config/pipelineConfig';
import type { DiscoveredProductService } from '../../discovered/DiscoveredProductService';
import { logger } from '../../logger';
import { resolveCountryCode } from '../../merchant-pricing/country';
import type { AiDraftInput, ResolveDraftResult } from '../../product-intelligence/domain/types';
import { resolvePersistableCategory } from '../../product-intelligence/domain/categoryTaxonomy';
import {
  isAffiliateOrSocialRedirectUrl,
  isQualifyingMerchantSeedUrl,
} from '../../product-intelligence/search/directUrlIdentity';
import type { ContentSourceRepository } from '../ContentSourceRepository';
import type { ContentSourceProductRecord } from '../domain/types';
import { enqueueContentSourceEnrichment } from '../jobs/contentSourceQueue';
import type { UserCommerceCountryPort, UserImportLookupPort } from '../ports';

export type UserImportResolvePort = {
  resolveForUserImport(drafts: AiDraftInput[]): Promise<ResolveDraftResult[]>;
  resolveForUserImportFast(drafts: AiDraftInput[]): Promise<ResolveDraftResult[]>;
};

/**
 * Global resolve + per-user Bag fan-out for a content source.
 * Fast path: local catalog / discovered stub → Bag → READY.
 * Merchant enrichment is enqueued afterward and never blocks discovery progress.
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

  async resolveAndFanOut(contentSourceId: string): Promise<void> {
    await this.discoverProductsFast(contentSourceId);
    await this.fanOutAll(contentSourceId);
  }

  /** Local catalog hit or discovered stub — no Serper/Tavily. */
  async discoverProductsFast(contentSourceId: string): Promise<void> {
    const source = await this.sources.findById(contentSourceId);
    if (!source) return;
    const products = await this.sources.listProducts(source.id);
    const processorVersion = getPipelineConfig().pipelineVersion;

    for (const product of products) {
      if (product.catalogProductId || product.discoveredProductId) continue;
      const draft = toDraft(product);
      const [result] = await this.resolver.resolveForUserImportFast([draft]);
      if (!result) continue;

      if (result.catalogProductId) {
        await this.sources.bindProductResolution(product.id, {
          catalogProductId: result.catalogProductId,
          discoveredProductId: null,
        });
        continue;
      }

      if (result.discovered) {
        const saved = await this.discovered.getOrCreate(result.discovered, processorVersion);
        await this.sources.bindProductResolution(product.id, {
          catalogProductId: null,
          discoveredProductId: saved.record.id,
        });
      }
    }
  }

  /** Queue PI merchant enrichment for each discovered product (non-blocking for Bag). */
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

  /** Full Serper/Tavily resolve + in-place discovered update. */
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

    const draft = toDraft(product);
    draft.commerceCountry = await this.resolveCommerceCountry(input);
    // Only genuine commerce PDPs become discovery seeds. Affiliate/social redirects
    // (liketk.it, rstyle.me, …) stay on the product as source context but must not
    // set creatorSuppliedUrl / suppress Serper merchant discovery.
    const rawMerchantUrl = product.merchantUrl?.startsWith('http') ? product.merchantUrl : null;
    if (rawMerchantUrl && isQualifyingMerchantSeedUrl(rawMerchantUrl)) {
      draft.creatorSuppliedUrl = true;
    } else if (rawMerchantUrl && isAffiliateOrSocialRedirectUrl(rawMerchantUrl)) {
      logger.info(
        {
          contentSourceId: input.contentSourceId,
          discoveredProductId: input.discoveredProductId,
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
    logger.info(
      {
        contentSourceId: input.contentSourceId,
        discoveredProductId: input.discoveredProductId,
        commerceCountry: draft.commerceCountry,
      },
      'merchant_discovery.country_resolved',
    );
    const [result] = await this.resolver.resolveForUserImport([draft]);
    if (!result?.discovered) return;

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
      await this.addBagLine(row, product);
    }
  }

  private async addBagLine(
    row: { id: string; userId: string; contentSourceId: string | null },
    product: ContentSourceProductRecord,
  ): Promise<void> {
    const source = {
      surface: 'USER_IMPORT' as const,
      contentSourceId: row.contentSourceId,
      userImportId: row.id,
    };
    try {
      if (product.catalogProductId) {
        await this.cart.addItem(row.userId, {
          catalogProductId: product.catalogProductId,
          source,
        });
        return;
      }
      if (product.discoveredProductId) {
        await this.cart.addItem(row.userId, {
          discoveredProductId: product.discoveredProductId,
          source,
        });
      }
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
