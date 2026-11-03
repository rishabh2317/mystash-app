import { abortImportOperation, assertImportWorkActive, importWorkContext, StaleImportWorkError } from '../../user-import/workContext';
import { importExtractionVersion, runImportWork } from '../../user-import/ImportProgressRepository';
import type { ImportProgressRepository, ImportProgress } from '../../user-import/ImportProgressRepository';
import { syncImportPlaces } from '../../place/syncImportPlaces';
import { getPipelineConfig } from '../../config/pipelineConfig';
import type { ContentSourceRepository } from '../ContentSourceRepository';
import { buildContentSourceEventPayload } from '../domain/events';
import { shouldClaimForProcessing } from '../domain/lifecycle';
import type { ContentSourceRecord, InsertContentSourceProductRow, VideoExtractionPortResult } from '../domain/types';
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
import { placeHypothesisKey } from '../../place/domain/hypothesisKey';
import type { ExtractedPlaceMention } from '../../place/parseReasonerPayload';

export type ContentSourceProcessContext = {
  attemptsMade: number;
  maxAttempts: number;
};

export type ContentSourceProcessorDeps = {
  sources: ContentSourceRepository;
  progress?: ImportProgressRepository;
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
    provisional?: boolean;
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
    if (this.deps.progress) {
      const source = await this.deps.sources.findById(data.contentSourceId);
      if (!source || !shouldClaimForProcessing(source.processingStatus)) return;
      await runImportWork(this.deps.progress, data.contentSourceId,
        (reporting, previous) => this.processOwned(data, ctx, reporting, previous));
    } else await this.processOwned(data, ctx);
  }

  private async processOwned(data: ContentSourceProcessingJobData, ctx: ContentSourceProcessContext,
    ownedReporting?: ImportProgress, previousReporting?: ImportProgress | null): Promise<void> {
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

    let reporting: ImportProgress | undefined = ownedReporting;
    try {
      const previous = previousReporting ?? (ownedReporting ? null : await this.deps.progress?.get(claimed.id));
      // Retry only the failed downstream branch using already-persisted evidence.
      // Shared extraction failures mark both failed and still follow the original path.
      const resume = previous && previous.evidenceComplete !== false && previous.extractionVersion === importExtractionVersion() && ((previous.products === 'complete' && previous.places === 'failed')
        || (previous.places === 'complete' && (previous.products === 'failed'
          || (previous.products === 'running' && ctx.attemptsMade > 0)))) ? previous : null;
      reporting ??= await this.deps.progress?.begin(claimed.id);
      const runBranch = async (branch: 'products' | 'places', task: () => Promise<number | void>) => {
        try {
          assertImportWorkActive();
          const value = await abortImportOperation(task());
          assertImportWorkActive();
          const verificationFailed = branch === 'places' && this.deps.places
            && (await this.deps.places.listHypotheses(claimed.id)).some((h) => h.unresolvedReason === 'provider_failed');
          if (reporting) await this.deps.progress?.finish(claimed.id, reporting.attemptId, branch, verificationFailed ? 'failed' : 'complete');
          return value;
        } catch (err) {
          assertImportWorkActive();
          if (reporting) await this.deps.progress?.finish(claimed.id, reporting.attemptId, branch,
            branch === 'products' && ctx.attemptsMade + 1 < ctx.maxAttempts ? 'running' : 'failed');
          throw err;
        }
      };
      const settle = <T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> => promise.then(
        (value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }));
      let productsTask: Promise<PromiseSettledResult<number | void>> | undefined;
      let placesTail = Promise.resolve();
      const startProducts = (rows: InsertContentSourceProductRow[], incomplete = false) => {
        if (productsTask) return;
        productsTask = settle(runBranch('products', async () => {
          if (!resume) await this.deps.sources.replaceProducts(claimed.id, rows);
          const count = resume?.products === 'complete'
            ? (await this.deps.sources.listProducts(claimed.id)).filter((p) => p.catalogProductId || p.discoveredProductId).length
            : await this.resolveProducts(claimed.id, data.userImportId);
          if (incomplete) throw new Error('Product evidence enrichment could not finish');
          return count;
        }));
      };
      const onEvidence = (snapshot: VideoExtractionPortResult) => {
        assertImportWorkActive();
        if (!resume && snapshot.productsSettled) startProducts(this.videoRows(claimed, snapshot));
        if (snapshot.finalEvidence || resume?.places === 'complete' || !snapshot.earlyPlaces?.length) return;
        placesTail = placesTail.then(async () => {
          assertImportWorkActive();
          await this.resolvePlaces({ mediaKind: claimed.mediaKind, contentSourceId: claimed.id,
            imports: await this.deps.userImports.listByContentSourceId(claimed.id),
            mentions: snapshot.earlyPlaces!, provisional: true });
          if (snapshot.placesSettled && reporting && this.deps.places) {
            const hypotheses = await this.deps.places.listHypotheses(claimed.id);
            const resolvedKeys = new Set(hypotheses.filter((h) => h.placeId).map((h) => h.hypothesisKey));
            if (snapshot.earlyPlaces!.every((p) => resolvedKeys.has(placeHypothesisKey({ extractedName: p.name, ...p })))) {
              await this.deps.progress?.finish(claimed.id, reporting.attemptId, 'places', 'complete');
            }
          }
        }).catch((err) => {
          // Final evidence retries persistence (using memoized provider results).
          // No detached rejection, and cancelled scopes cannot publish late writes.
          logger.warn({ err, contentSourceId: claimed.id }, 'place.early_resolution.failed');
        });
      };
      const hypotheses = resume && this.deps.places ? await this.deps.places.listHypotheses(claimed.id) : [];
      const extracted = resume && (resume.places === 'complete' || hypotheses.length > 0) ? {
        rows: [], places: hypotheses.map((h) => ({ name: h.extractedName, category: h.category,
          locality: h.locality, city: h.city, region: h.region, country: h.country, mentionedAddress: h.mentionedAddress,
          confidence: h.confidence, evidence: h.evidence, sources: h.sources })),
      } : await abortImportOperation(this.extractRows(claimed, data.traceId ?? claimed.id, base, onEvidence));
      if (reporting && !extracted.productsIncomplete) await this.deps.progress?.completeEvidence?.(claimed.id, reporting.attemptId);
      startProducts(extracted.rows, extracted.productsIncomplete);
      const placesTask = settle(runBranch('places', async () => {
        await placesTail;
        try {
          if (resume?.places !== 'complete') await this.resolvePlaces({ mediaKind: claimed.mediaKind, contentSourceId: claimed.id,
            imports: await this.deps.userImports.listByContentSourceId(claimed.id), mentions: extracted.places });
        } catch (err) {
          assertImportWorkActive();
          await this.saveUnresolvedPlaceLeadsFallback({ contentSourceId: claimed.id,
            imports: await this.deps.userImports.listByContentSourceId(claimed.id), mentions: extracted.places });
          throw err;
        }
        if (this.deps.places) for (const row of await this.deps.userImports.listByContentSourceId(claimed.id)) {
          try { await syncImportPlaces(this.deps.places, { ...row, contentSourceId: claimed.id }); }
          catch {
            assertImportWorkActive();
            logger.warn({ userImportId: row.id }, 'place.stash_sync.deferred');
          }
        }
      }));
      const [placeOutcome, productOutcome] = await Promise.all([placesTask, productsTask!]);
      if (placeOutcome.status === 'rejected') {
        logger.warn({ err: placeOutcome.reason, contentSourceId: claimed.id }, 'place.lead.persist_failed');
      }

      if (productOutcome.status === 'rejected') {
        throw productOutcome.reason;
      }

      const attachedCount = typeof productOutcome.value === 'number' ? productOutcome.value : 0;
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
      const work = importWorkContext.getStore();
      if (work && this.deps.progress?.isCurrent && !(await importWorkContext.exit(() =>
        this.deps.progress!.isCurrent!(claimed.id, work.attemptId)))) throw new StaleImportWorkError();
      const finalize = async () => {
        if (reporting) {
          const latest = await this.deps.progress?.get(claimed.id);
          const status = !(err instanceof ContentSourceTerminalError) && ctx.attemptsMade + 1 < ctx.maxAttempts ? 'running' : 'failed';
          await Promise.all((['products', 'places'] as const).map((branch) => latest?.[branch] === 'complete'
            ? Promise.resolve() : this.deps.progress?.finish(claimed.id, reporting!.attemptId, branch, status)));
        }
        await this.handleFailure(claimed, ctx, err, started, base);
      };
      if (work?.signal.aborted) {
        await importWorkContext.run({ ...work, signal: AbortSignal.timeout(10_000) }, finalize);
      } else await finalize();
    }
  }

  private async resolvePlaces(input: {
    provisional?: boolean;
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
        provisional: input.provisional,
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
    if (!this.deps.places || input.provisional) return;
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

  private videoRows(source: ContentSourceRecord, extracted: VideoExtractionPortResult): InsertContentSourceProductRow[] {
    return mapExtractedProducts({ contentSourceId: source.id,
      products: limitProductsForUserImport(dropProductsMatchingKeptPlaces(extracted.products, extracted.places ?? []), getPipelineConfig().maxProductsPerImport),
      extractionMethod: extracted.extractionMethod,
      processorVersion: this.deps.processorVersion ?? `${CONTENT_SOURCE_PROCESSOR_VERSION}/${getPipelineConfig().pipelineVersion}`,
      sourceMetadata: { finalStage: extracted.finalStage, cacheHit: extracted.cacheHit, canonicalUrl: source.canonicalUrl,
        platform: source.platform, externalId: source.externalId },
    });
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
    onEvidence?: (snapshot: VideoExtractionPortResult) => void,
  ): Promise<{ rows: InsertContentSourceProductRow[]; places: ExtractedPlaceMention[]; productsIncomplete?: boolean }> {
    const processorVersion =
      this.deps.processorVersion ??
      `${CONTENT_SOURCE_PROCESSOR_VERSION}/${getPipelineConfig().pipelineVersion}`;

    if (source.mediaKind === 'VIDEO') {
      const extracted = await this.deps.video.extract({ contentSource: source, traceId, onEvidence });
      emitContentSourceEvent(
        extracted.cacheHit ? 'ContentSourceExtractionCacheHit' : 'ContentSourceExtractionCacheMiss',
        buildContentSourceEventPayload({
          ...base,
          processingStatus: 'PROCESSING',
          cacheHit: extracted.cacheHit,
          extractionMethod: extracted.extractionMethod,
        }),
      );
      // Display metadata is already obtained by the shared extractor/cache. No
      // provider work, changes to evidence, or writes on the Places GET path.
      const title = extracted.metadata?.title?.trim();
      let thumbnail: string | undefined;
      if (extracted.metadata?.thumbnailUrl) {
        try {
          const url = new URL(extracted.metadata.thumbnailUrl.trim());
          if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) thumbnail = url.href;
        } catch { /* Missing/invalid metadata is not an extraction failure. */ }
      }
      if ((!source.title && title) || (!source.thumbnailUrl && thumbnail)) {
        assertImportWorkActive();
        try {
          await this.deps.sources.patchDisplay(source.id, {
            ...(!source.title && title ? { title } : {}),
            ...(!source.thumbnailUrl && thumbnail ? { thumbnailUrl: thumbnail } : {}),
          });
        } catch (err) {
          assertImportWorkActive();
          logger.warn({ err, contentSourceId: source.id }, 'content_source.display_metadata.failed');
        }
      }
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
      return {
        rows: this.videoRows(source, extracted), productsIncomplete: extracted.productsIncomplete,
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
