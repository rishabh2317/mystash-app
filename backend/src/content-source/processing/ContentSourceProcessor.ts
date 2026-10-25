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
import { logger } from '../../logger';
import type { PlaceRepository } from '../../place/PlaceRepository';
import type { PlaceResolutionSummary } from '../../place/PlaceResolver';
import { persistUnresolvedPlaceLeads } from '../../place/persistUnresolvedPlaceLeads';
import { dropProductsMatchingKeptPlaces } from '../../place/dropProductsMatchingKeptPlaces';
import type { ExtractedPlaceMention } from '../../place/parseReasonerPayload';

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
  /** When set without a resolver, specific video place mentions are saved as unresolved leads. */
  places?: PlaceRepository | null;
  /** When set, video place mentions are resolved. Canonical rows are written only on an accepted match. */
  placeResolver?: ContentSourcePlaceResolutionPort | null;
};

export type ContentSourcePlaceResolutionPort = {
  resolveMentions(input: {
    contentSourceId: string;
    imports: Array<{ id: string; userId: string }>;
    mentions: ExtractedPlaceMention[];
  }): Promise<PlaceResolutionSummary>;
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
      const extracted = await this.extractRows(claimed, data.traceId ?? claimed.id, base);
      const persisted = await this.deps.sources.replaceProducts(claimed.id, extracted.rows);
      emitContentSourceEvent(
        'ContentSourceCandidatesPersisted',
        buildContentSourceEventPayload({
          ...base,
          processingStatus: 'PROCESSING',
          candidateCount: persisted.length,
        }),
      );

      const [placeOutcome, productOutcome] = await Promise.allSettled([
        this.resolvePlaces({
          mediaKind: claimed.mediaKind,
          contentSourceId: claimed.id,
          imports,
          mentions: extracted.places,
        }),
        this.resolveProducts(claimed.id, data.userImportId),
      ]);

      if (placeOutcome.status === 'rejected') {
        logger.warn(
          { err: placeOutcome.reason, contentSourceId: claimed.id },
          'place.lead.persist_failed',
        );
        await this.saveUnresolvedPlaceLeadsFallback({
          contentSourceId: claimed.id,
          imports,
          mentions: extracted.places,
        });
      }

      if (productOutcome.status === 'rejected') {
        throw productOutcome.reason;
      }

      const attachedCount = productOutcome.value;
      const ready = await this.deps.sources.markReady(claimed.id, {
        lastProcessedAt: this.now().toISOString(),
        candidateCount: attachedCount,
      });

      emitContentSourceEvent(
        'ContentSourceProcessingCompleted',
        buildContentSourceEventPayload({
          ...base,
          processingStatus: ready?.processingStatus ?? 'READY',
          candidateCount: attachedCount,
          durationMs: Date.now() - started.getTime(),
        }),
      );
    } catch (err) {
      await this.handleFailure(claimed, ctx, err, started, base);
    }
  }

  private async resolvePlaces(input: {
    mediaKind: string;
    contentSourceId: string;
    imports: Array<{ id: string; userId: string }>;
    mentions: ExtractedPlaceMention[];
  }): Promise<void> {
    if (input.mediaKind !== 'VIDEO' || (!this.deps.placeResolver && !this.deps.places)) return;
    if (this.deps.placeResolver) {
      const saved = await this.deps.placeResolver.resolveMentions({
        contentSourceId: input.contentSourceId,
        imports: input.imports,
        mentions: input.mentions,
      });
      logger.info(
        {
          contentSourceId: input.contentSourceId,
          kept: saved.kept,
          discarded: saved.discarded,
          leads: saved.leads,
          resolved: saved.resolved,
        },
        'place.resolution.completed',
      );
      return;
    }
    if (!this.deps.places) return;
    const saved = await persistUnresolvedPlaceLeads({
      repository: this.deps.places,
      contentSourceId: input.contentSourceId,
      imports: input.imports,
      mentions: input.mentions,
    });
    logger.info(
      {
        contentSourceId: input.contentSourceId,
        kept: saved.kept,
        discarded: saved.discarded,
        leads: saved.leads,
      },
      'place.lead.persisted',
    );
  }

  private async saveUnresolvedPlaceLeadsFallback(input: {
    contentSourceId: string;
    imports: Array<{ id: string; userId: string }>;
    mentions: ExtractedPlaceMention[];
  }): Promise<void> {
    if (!this.deps.places) return;
    try {
      const saved = await persistUnresolvedPlaceLeads({
        repository: this.deps.places,
        contentSourceId: input.contentSourceId,
        imports: input.imports,
        mentions: input.mentions,
      });
      logger.info(
        {
          contentSourceId: input.contentSourceId,
          kept: saved.kept,
          discarded: saved.discarded,
          leads: saved.leads,
        },
        'place.lead.persisted',
      );
    } catch (err) {
      logger.warn(
        { err, contentSourceId: input.contentSourceId },
        'place.lead.persist_failed',
      );
    }
  }

  private async resolveProducts(contentSourceId: string, userImportId?: string): Promise<number> {
    if (!this.deps.resolution) return 0;
    const attached = await this.deps.resolution.resolveAndFanOut(contentSourceId, userImportId);
    return Number.isInteger(attached) ? attached : 0;
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
  ): Promise<{ rows: InsertContentSourceProductRow[]; places: ExtractedPlaceMention[] }> {
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
      const products = dropProductsMatchingKeptPlaces(extracted.products, extracted.places ?? []);
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
          cacheHit: extracted.cacheHit,
          extractionMethod: extracted.extractionMethod,
          candidateCount: products.length,
        }),
      );
      const capped = limitProductsForUserImport(
        products,
        getPipelineConfig().maxProductsPerImport,
      );
      return {
        rows: mapExtractedProducts({
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
        }),
        places: extracted.places ?? [],
      };
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
      return {
        rows: mapExtractedProducts({
          contentSourceId: source.id,
          products: limitProductsForUserImport(products, getPipelineConfig().maxProductsPerImport),
          extractionMethod: 'merchant_enrichment',
          processorVersion,
          sourceMetadata: {
            canonicalUrl: source.canonicalUrl,
            platform: source.platform,
            externalId: source.externalId,
          },
        }),
        places: [],
      };
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
