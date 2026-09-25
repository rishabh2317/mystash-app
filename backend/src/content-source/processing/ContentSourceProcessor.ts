import { getPipelineConfig } from '../../config/pipelineConfig';
import type { ContentSourceRepository } from '../ContentSourceRepository';
import { buildContentSourceEventPayload } from '../domain/events';
import { shouldClaimForProcessing } from '../domain/lifecycle';
import type { ContentSourceRecord, InsertContentSourceProductRow } from '../domain/types';
import type { ContentSourceProcessingJobData } from '../jobs/jobIdentity';
import { contentSourceProcessingJobId } from '../jobs/jobIdentity';
import { emitContentSourceEvent } from '../observability';
import type {
  UserImportLookupPort,
  VideoExtractionPort,
  WebEnrichmentPort,
  ContentSourceResolutionPort,
} from '../ports';
import { CONTENT_SOURCE_PROCESSOR_VERSION, ContentSourceTerminalError } from './errors';
import { mapExtractedProducts, limitProductsForUserImport } from './mapCandidates';

export type ContentSourceProcessContext = {
  attemptsMade: number;
  maxAttempts: number;
};

export type ContentSourceProcessorDeps = {
  sources: ContentSourceRepository;
  userImports: UserImportLookupPort;
  video: VideoExtractionPort;
  web: WebEnrichmentPort;
  now?: () => Date;
  processorVersion?: string;
  resolution?: ContentSourceResolutionPort | null;
};

/**
 * Global content-source processing. Work identity is contentSourceId.
 * userImportId on the job is tracing only — results belong to the content source.
 */
export class ContentSourceProcessor {
  constructor(private readonly deps: ContentSourceProcessorDeps) {}

  async process(
    data: ContentSourceProcessingJobData,
    ctx: ContentSourceProcessContext = { attemptsMade: 0, maxAttempts: 3 },
  ): Promise<void> {
    const started = this.now();
    const source = await this.deps.sources.findById(data.contentSourceId);
    if (!source) {
      emitContentSourceEvent(
        'ContentSourceProcessingFailed',
        buildContentSourceEventPayload({
          contentSourceId: data.contentSourceId,
          platform: null,
          externalId: null,
          mediaKind: null,
          processingStatus: null,
          userImportId: data.userImportId,
          jobId: contentSourceProcessingJobId(data.contentSourceId),
          reason: 'missing_content_source',
        }),
      );
      return;
    }

    if (!shouldClaimForProcessing(source.processingStatus)) {
      return;
    }

    const claimed = await this.deps.sources.markProcessing(source.id);
    if (!claimed) {
      return;
    }

    const imports = await this.deps.userImports.listByContentSourceId(claimed.id);
    const base = {
      contentSourceId: claimed.id,
      platform: claimed.platform,
      externalId: claimed.externalId,
      mediaKind: claimed.mediaKind,
      userImportId: data.userImportId,
      jobId: contentSourceProcessingJobId(claimed.id),
      importCount: imports.length,
    };

    emitContentSourceEvent(
      'ContentSourceProcessingStarted',
      buildContentSourceEventPayload({
        ...base,
        processingStatus: claimed.processingStatus,
      }),
    );

    try {
      const rows = await this.extractRows(claimed, data.traceId ?? claimed.id, base);
      const persisted = await this.deps.sources.replaceProducts(claimed.id, rows);
      emitContentSourceEvent(
        'ContentSourceCandidatesPersisted',
        buildContentSourceEventPayload({
          ...base,
          processingStatus: 'PROCESSING',
          candidateCount: persisted.length,
        }),
      );

      if (this.deps.resolution) {
        await this.deps.resolution.resolveAndFanOut(claimed.id);
      }

      const ready = await this.deps.sources.markReady(claimed.id, {
        lastProcessedAt: this.now().toISOString(),
        candidateCount: persisted.length,
      });

      emitContentSourceEvent(
        'ContentSourceProcessingCompleted',
        buildContentSourceEventPayload({
          ...base,
          processingStatus: ready?.processingStatus ?? 'READY',
          candidateCount: persisted.length,
          durationMs: Date.now() - started.getTime(),
        }),
      );

      // Merchant enrichment is best-effort and must not keep discovery "looking".
      if (this.deps.resolution?.enqueueMerchantEnrichment) {
        void this.deps.resolution
          .enqueueMerchantEnrichment(claimed.id, data.userImportId, data.traceId)
          .catch(() => undefined);
      }
    } catch (err) {
      await this.handleFailure(claimed, ctx, err, started, base);
    }
  }

  private async extractRows(
    source: ContentSourceRecord,
    traceId: string,
    base: {
      contentSourceId: string;
      platform: ContentSourceRecord['platform'];
      externalId: string;
      mediaKind: string;
      userImportId: string;
      jobId: string;
      importCount: number;
    },
  ): Promise<InsertContentSourceProductRow[]> {
    const processorVersion =
      this.deps.processorVersion ??
      `${CONTENT_SOURCE_PROCESSOR_VERSION}/${getPipelineConfig().pipelineVersion}`;

    if (source.mediaKind === 'VIDEO') {
      const extracted = await this.deps.video.extract({ contentSource: source, traceId });
      emitContentSourceEvent(
        extracted.cacheHit ? 'ContentSourceExtractionCacheHit' : 'ContentSourceExtractionCacheMiss',
        buildContentSourceEventPayload({
          ...base,
          processingStatus: 'PROCESSING',
          cacheHit: extracted.cacheHit,
          extractionMethod: extracted.extractionMethod,
        }),
      );
      emitContentSourceEvent(
        'ContentSourceExtractionCompleted',
        buildContentSourceEventPayload({
          ...base,
          processingStatus: 'PROCESSING',
          cacheHit: extracted.cacheHit,
          extractionMethod: extracted.extractionMethod,
          reason: extracted.finalStage,
        }),
      );
      emitContentSourceEvent(
        'ContentSourceCandidatesDetected',
        buildContentSourceEventPayload({
          ...base,
          processingStatus: 'PROCESSING',
          candidateCount: extracted.products.length,
          extractionMethod: extracted.extractionMethod,
        }),
      );
      const capped = limitProductsForUserImport(
        extracted.products,
        getPipelineConfig().maxProductsPerImport,
      );
      return mapExtractedProducts({
        contentSourceId: source.id,
        products: capped,
        extractionMethod: extracted.extractionMethod,
        processorVersion,
        sourceMetadata: {
          finalStage: extracted.finalStage,
          cacheHit: extracted.cacheHit,
          canonicalUrl: source.canonicalUrl,
          platform: source.platform,
          externalId: source.externalId,
        },
      });
    }

    if (source.mediaKind === 'WEB_PAGE') {
      const enriched = await this.deps.web.enrich({ contentSource: source, traceId });
      emitContentSourceEvent(
        'ContentSourceExtractionCompleted',
        buildContentSourceEventPayload({
          ...base,
          processingStatus: 'PROCESSING',
          extractionMethod: 'merchant_enrichment',
        }),
      );
      const products = enriched.candidate
        ? [
            {
              name: enriched.candidate.name,
              brand: enriched.candidate.brand,
              category: enriched.candidate.category,
              price: enriched.candidate.price,
              currency: enriched.candidate.currency,
              image: enriched.candidate.image,
              merchantUrl: enriched.candidate.merchantUrl,
              evidence: enriched.candidate.evidence,
              externalId: source.externalId,
              sortOrder: 1,
            },
          ]
        : [];
      emitContentSourceEvent(
        'ContentSourceCandidatesDetected',
        buildContentSourceEventPayload({
          ...base,
          processingStatus: 'PROCESSING',
          candidateCount: products.length,
          extractionMethod: 'merchant_enrichment',
        }),
      );
      return mapExtractedProducts({
        contentSourceId: source.id,
        products: limitProductsForUserImport(products, getPipelineConfig().maxProductsPerImport),
        extractionMethod: 'merchant_enrichment',
        processorVersion,
        sourceMetadata: {
          canonicalUrl: source.canonicalUrl,
          platform: source.platform,
          externalId: source.externalId,
        },
      });
    }

    throw new ContentSourceTerminalError(
      'Content source has an unsupported media kind',
      'MALFORMED_IDENTITY',
    );
  }

  private async handleFailure(
    source: ContentSourceRecord,
    ctx: ContentSourceProcessContext,
    err: unknown,
    started: Date,
    base: {
      contentSourceId: string;
      platform: ContentSourceRecord['platform'];
      externalId: string;
      mediaKind: string;
      userImportId: string;
      jobId: string;
      importCount: number;
    },
  ): Promise<void> {
    const message = err instanceof Error ? err.message.slice(0, 200) : 'processing_failed';
    const terminal = err instanceof ContentSourceTerminalError;
    const lastAttempt = ctx.attemptsMade + 1 >= ctx.maxAttempts;
    const durationMs = Date.now() - started.getTime();

    if (terminal || lastAttempt) {
      await this.deps.sources.markFailed(source.id, {
        lastProcessedAt: this.now().toISOString(),
        reason: message,
      });
      emitContentSourceEvent(
        'ContentSourceProcessingTerminalFailure',
        buildContentSourceEventPayload({
          ...base,
          processingStatus: 'FAILED',
          reason: message,
          durationMs,
          retryable: false,
        }),
      );
      emitContentSourceEvent(
        'ContentSourceProcessingFailed',
        buildContentSourceEventPayload({
          ...base,
          processingStatus: 'FAILED',
          reason: message,
          durationMs,
          retryable: false,
        }),
      );
      if (!terminal) throw err;
      return;
    }

    emitContentSourceEvent(
      'ContentSourceProcessingRetryableFailure',
      buildContentSourceEventPayload({
        ...base,
        processingStatus: 'PROCESSING',
        reason: message,
        durationMs,
        retryable: true,
      }),
    );
    throw err;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}
