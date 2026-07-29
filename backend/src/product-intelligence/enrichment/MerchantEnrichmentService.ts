import { ingestLog } from '../../pipeline/ingestLog';
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
      const raw = await this.extractor.extract(input);
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

      const metadata = this.normalizer.normalize(raw, {
        brandHint: input.brandHint,
        categoryHint: input.categoryHint,
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
