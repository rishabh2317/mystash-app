import { ingestLog } from '../../pipeline/ingestLog';
import { privateImageContext } from '../../user-import/media/privacy';
import type { MerchantExtractor } from './MerchantExtractor';
import { MerchantMetadataNormalizer } from './MerchantMetadataNormalizer';
import { MerchantMetadataValidator } from './MerchantMetadataValidator';
import type {
  MerchantEnrichmentInput,
  MerchantEnrichmentResult,
  MerchantProductMetadata,
} from './types';

/**
 * Merchant Product Enrichment — single service Product Intelligence plugs into.
 * Resolver / SearchStrategy remain unaware of Tavily vs future Firecrawl/etc.
 */
export class MerchantEnrichmentService {
  private readonly normalizer = new MerchantMetadataNormalizer();
  private readonly validator = new MerchantMetadataValidator();

  constructor(private readonly extractor: MerchantExtractor) {}

  async enrich(input: MerchantEnrichmentInput): Promise<MerchantEnrichmentResult> {
    const t0 = performance.now();
    const provider = this.extractor.name;

    ingestLog('info', 'merchant.enrichment.started', {
      svc: 'product-intelligence',
      provider,
      merchantUrl: input.merchantUrl.slice(0, 160),
      ingestId: input.ingestId,
    });

    try {
      const privateImage = privateImageContext.getStore() === true;
      // Image-derived hints may select a public PDP, but cannot fill missing
      // merchant facts or gain merchant provenance through normalization.
      const merchantInput = privateImage
        ? { ...input, titleHint: null, brandHint: null, categoryHint: null }
        : input;
      const raw = await this.extractor.extract(merchantInput);
      if (!raw) {
        const message = 'extractor returned empty';
        ingestLog('warn', 'merchant.enrichment.failed', {
          svc: 'product-intelligence',
          provider,
          message,
          durationMs: Math.round(performance.now() - t0),
        });
        return { kind: 'failed', message, provider };
      }

      if (privateImage && raw.identitySource !== 'merchant_html') {
        return { kind: 'failed', message: 'independent_merchant_identity_required', provider };
      }
      const merchantFacts = privateImage && raw.priceSource === 'ai'
        ? { ...raw, price: null, currency: null, priceSource: null }
        : raw;
      const metadata = this.normalizer.normalize(merchantFacts, {
        brandHint: merchantInput.brandHint,
        categoryHint: merchantInput.categoryHint,
        productName: merchantInput.titleHint,
      });
      const validation = this.validator.validate(metadata);
      if (!validation.ok) {
        ingestLog('warn', 'merchant.enrichment.failed', {
          svc: 'product-intelligence',
          provider,
          message: validation.errors.join(','),
          durationMs: Math.round(performance.now() - t0),
        });
        return { kind: 'failed', message: validation.errors.join(','), provider };
      }

      this.logCompleted(metadata, Math.round(performance.now() - t0));
      return { kind: 'ok', metadata };
    } catch (e) {
      const message = (e as Error).message?.slice(0, 200) || 'enrichment_exception';
      ingestLog('warn', 'merchant.enrichment.failed', {
        svc: 'product-intelligence',
        provider,
        message,
        durationMs: Math.round(performance.now() - t0),
      });
      return { kind: 'failed', message, provider };
    }
  }

  private logCompleted(metadata: MerchantProductMetadata, durationMs: number): void {
    ingestLog('info', 'merchant.enrichment.completed', {
      svc: 'product-intelligence',
      merchant: metadata.merchant,
      provider: metadata.provider,
      durationMs,
      thumbnailFound: !!metadata.image,
      descriptionFound: !!metadata.description,
      priceFound: !!metadata.price,
      specCount: Object.keys(metadata.specifications).length,
      metadataCompleteness: metadata.metadataCompleteness,
    });
  }
}
