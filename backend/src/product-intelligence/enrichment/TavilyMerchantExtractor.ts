import type { SupabaseClient } from '@supabase/supabase-js';
import { previewProductLink } from '../../pipeline/productLinkPreview';
import type { MerchantExtractor } from './MerchantExtractor';
import type { MerchantEnrichmentInput, MerchantProductMetadata } from './types';
import { detectMerchantLabel } from './merchantDetect';

/**
 * Single Mystash extraction path — reuses manual-ingest `previewProductLink`
 * (scrape → Tavily Extract → GPT). Do not add a parallel extractor here.
 */
export class TavilyMerchantExtractor implements MerchantExtractor {
  readonly name = 'tavily';

  constructor(private readonly admin: SupabaseClient) {}

  async extract(input: MerchantEnrichmentInput): Promise<Partial<MerchantProductMetadata> | null> {
    const preview = await previewProductLink(this.admin, input.merchantUrl, {
      ingestId: input.ingestId,
      traceId: input.traceId,
      acceptPartialCache: input.acceptPartialCache,
    });

    const merchant = preview.merchant ?? detectMerchantLabel(preview.merchantUrl);
    const price =
      preview.price && preview.price !== '—' && /\d/.test(preview.price) ? preview.price : null;
    const image = preview.image?.trim() || null;

    return {
      title: preview.name,
      brand: preview.brand ?? null,
      image,
      primaryImage: image,
      description: preview.description ?? null,
      shortDescription: null,
      merchant,
      merchantUrl: preview.merchantUrl,
      category: input.categoryHint ?? null,
      price,
      currency: price ? preview.currency ?? null : null,
      availability: null,
      specifications: preview.specifications ?? {},
      priceSource: price ? (preview.priceSource === 'ai' ? 'ai' : 'merchant') : null,
      priceLastVerifiedAt: price ? new Date().toISOString() : null,
      extractedAt: new Date().toISOString(),
      provider: this.name,
      metadataCompleteness: 0,
    };
  }
}
