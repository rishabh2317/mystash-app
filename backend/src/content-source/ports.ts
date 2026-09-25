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
  enqueueMerchantEnrichment?(
    contentSourceId: string,
    userImportId: string,
    traceId?: string,
  ): Promise<void>;
  enrichDiscoveredProduct?(input: {
    contentSourceId: string;
    contentSourceProductId: string;
    discoveredProductId: string;
    /** Triggering user-import — used to resolve commerce country for discovery. */
    userImportId?: string;
    /** Pre-resolved ISO country; when set, skips user lookup. */
    commerceCountry?: string | null;
  }): Promise<void>;
};

export type UserImportLookupPort = {
  listByContentSourceId(contentSourceId: string): Promise<Array<{ id: string; userId: string }>>;
  findById?(id: string): Promise<{ id: string; userId: string } | null>;
};

/** Optional port so enrichment can resolve the importing user's commerce country. */
export type UserCommerceCountryPort = {
  getCommerceCountry(userId: string): Promise<string | null>;
};
