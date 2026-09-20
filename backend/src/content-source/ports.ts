import type { ContentSourceRecord, VideoExtractionPortResult, WebEnrichmentPortResult } from './domain/types';
import type { ContentSourceProcessingJobData } from './jobs/jobIdentity';

/**
 * Queue port for global content processing. Keeps ContentSourceService independent of
 * BullMQ/Redis so the handoff can be unit-tested without infrastructure.
 */
export type ContentProcessingQueuePort = {
  enqueue(data: ContentSourceProcessingJobData): Promise<string>;
};

export type VideoExtractionPort = {
  extract(params: {
    contentSource: ContentSourceRecord;
    traceId: string;
  }): Promise<VideoExtractionPortResult>;
};

export type WebEnrichmentPort = {
  enrich(params: {
    contentSource: ContentSourceRecord;
    traceId: string;
  }): Promise<WebEnrichmentPortResult>;
};

export type ContentSourceResolutionPort = {
  resolveAndFanOut(contentSourceId: string): Promise<void>;
};

export type UserImportLookupPort = {
  listByContentSourceId(contentSourceId: string): Promise<Array<{ id: string; userId: string }>>;
};
