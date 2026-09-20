import type { SupabaseClient } from '@supabase/supabase-js';
import { videoExtractionCacheLookup } from '../domain/identity';
import type { ContentSourceRecord, VideoExtractionPortResult } from '../domain/types';
import type { VideoExtractionPort } from '../ports';
import { runProgressiveExtract, type ProgressiveExtractResult } from '../../stages/progressiveExtract';
import { ContentSourceTerminalError } from './errors';

export type ProgressiveExtractFn = typeof runProgressiveExtract;

/**
 * VIDEO sources: existing progressive extraction + video_extraction_cache.
 * Correlation id is the content source, never a user import.
 */
export function createVideoExtractionAdapter(
  admin: SupabaseClient,
  extract: ProgressiveExtractFn = runProgressiveExtract,
): VideoExtractionPort {
  return {
    async extract(params: {
      contentSource: ContentSourceRecord;
      traceId: string;
    }): Promise<VideoExtractionPortResult> {
      const lookup = videoExtractionCacheLookup(params.contentSource);
      if (!lookup) {
        throw new ContentSourceTerminalError(
          'Video source is missing a usable extraction identity',
          'MALFORMED_IDENTITY',
        );
      }

      const extracted: ProgressiveExtractResult = await extract({
        admin,
        sourceUrl: params.contentSource.canonicalUrl,
        platform: lookup.platform,
        externalVideoId: lookup.externalVideoId,
        correlationId: params.contentSource.id,
        traceId: params.traceId,
      });

      if (extracted.kind === 'source_unavailable') {
        throw new ContentSourceTerminalError(extracted.errorMessage, extracted.errorCode);
      }

      return {
        products: extracted.products.map((product) => ({
          name: product.name,
          category: product.category,
          brand: product.brand,
          model: product.model,
          confidence: product.confidence,
          evidence: product.evidence,
          sources: product.sources,
          price: product.price,
          currency: product.currency,
          merchantUrl: product.merchantUrl,
          image: product.image,
          externalId: product.externalId,
          sortOrder: product.sortOrder,
        })),
        cacheHit: extracted.cacheHit,
        empty: extracted.products.length === 0,
        finalStage: extracted.finalStage,
        extractionMethod: extracted.cacheHit ? 'cache' : 'ai_extract',
      };
    },
  };
}
