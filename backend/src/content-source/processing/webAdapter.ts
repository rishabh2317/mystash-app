import type { SupabaseClient } from '@supabase/supabase-js';
import { MerchantEnrichmentService } from '../../product-intelligence/enrichment/MerchantEnrichmentService';
import { TavilyMerchantExtractor } from '../../product-intelligence/enrichment/TavilyMerchantExtractor';
import { canonicalizeProductUrl, externalIdForProductUrl } from '../../pipeline/urlCanonicalization';
import { SafeHttpError } from '../../pipeline/safeHttp';
import type { ContentSourceRecord, WebEnrichmentPortResult } from '../domain/types';
import type { WebEnrichmentPort } from '../ports';
import { ContentSourceTerminalError } from './errors';

export type MerchantEnrichFn = MerchantEnrichmentService['enrich'];

function webPort(enrich: MerchantEnrichFn): WebEnrichmentPort {
  return {
    async enrich(params: {
      contentSource: ContentSourceRecord;
      traceId: string;
    }): Promise<WebEnrichmentPortResult> {
      let canonical: string;
      try {
        canonical = canonicalizeProductUrl(params.contentSource.canonicalUrl);
      } catch {
        throw new ContentSourceTerminalError(
          'Web source is missing a usable canonical URL',
          'MALFORMED_IDENTITY',
        );
      }
      if (!canonical) {
        throw new ContentSourceTerminalError(
          'Web source is missing a usable canonical URL',
          'MALFORMED_IDENTITY',
        );
      }

      try {
        const result = await enrich({
          merchantUrl: canonical,
          ingestId: params.contentSource.id,
          traceId: params.traceId,
          acceptPartialCache: false,
        });

        if (result.kind !== 'ok') {
          return { candidate: null, empty: true };
        }

        const metadata = result.metadata;
        const name = metadata.title?.trim();
        if (!name) {
          return { candidate: null, empty: true };
        }

        return {
          candidate: {
            name,
            brand: metadata.brand,
            category: metadata.category,
            price: metadata.price,
            currency: metadata.currency,
            image: metadata.image,
            merchantUrl: metadata.merchantUrl,
            evidence: {
              merchant: metadata.merchant,
              provider: metadata.provider,
              specifications: metadata.specifications,
              externalId: externalIdForProductUrl(canonical),
              canonicalUrl: canonical,
            },
          },
          empty: false,
        };
      } catch (err) {
        if (
          err instanceof SafeHttpError &&
          (err.code === 'PRIVATE_DESTINATION' || err.code === 'UNSUPPORTED_SCHEME')
        ) {
          throw new ContentSourceTerminalError(err.message, err.code);
        }
        throw err;
      }
    },
  };
}

/**
 * WEB_PAGE sources: existing canonicalizeProductUrl + MerchantEnrichmentService
 * (which itself reuses previewProductLink / TavilyMerchantExtractor).
 */
export function createWebEnrichmentAdapter(admin: SupabaseClient): WebEnrichmentPort {
  const service = new MerchantEnrichmentService(new TavilyMerchantExtractor(admin));
  return webPort((input) => service.enrich(input));
}

export function createWebEnrichmentAdapterFromService(
  service: MerchantEnrichmentService,
): WebEnrichmentPort {
  return webPort((input) => service.enrich(input));
}
