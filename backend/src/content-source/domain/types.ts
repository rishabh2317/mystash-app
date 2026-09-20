/**
 * Content Source domain types — global identity of shared content.
 *
 * A content source answers "this URL/content has been or is being processed". It is
 * globally reusable and never user-scoped: User Import owns submissions, Catalog owns
 * product identity, Cart owns Bag membership.
 */

/** Lowercase to match `detectPlatform` and `video_extraction_cache.platform`. */
export type ContentSourcePlatform = 'youtube' | 'instagram' | 'web';

export type ContentMediaKind = 'VIDEO' | 'WEB_PAGE';

export type ContentProcessingStatus =
  | 'RECEIVED'
  | 'QUEUED'
  | 'PROCESSING'
  | 'READY'
  | 'FAILED';

export type ContentSourceIdentity = {
  platform: ContentSourcePlatform;
  externalId: string;
  canonicalUrl: string;
  mediaKind: ContentMediaKind;
};

export type ContentSourceRecord = ContentSourceIdentity & {
  id: string;
  processingStatus: ContentProcessingStatus;
  pipelineVersion: string;
  queuedAt: string | null;
  lastProcessedAt: string | null;
  candidateCount: number;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
};

export type InsertContentSourceRow = ContentSourceIdentity & {
  processingStatus: ContentProcessingStatus;
  pipelineVersion: string;
};

export type ResolveContentSourceResult = {
  record: ContentSourceRecord;
  created: boolean;
};

export type RequestProcessingResult = {
  /** A processing job was handed to the queue and the row moved to QUEUED. */
  queued: boolean;
  /** Global work already queued / running / done — no second job was created. */
  suppressed: boolean;
  /** Enqueue failed; the row stays RECEIVED so it remains re-enqueueable. */
  enqueueFailed: boolean;
  jobId: string | null;
};

export type ContentExtractionMethod = 'ai_extract' | 'cache' | 'merchant_enrichment';

/**
 * A product candidate belonging to a content source — not Catalog, not Bag.
 * Fields match existing ProductCandidate / merchant metadata; nothing invented.
 */
export type ContentSourceProductRecord = {
  id: string;
  contentSourceId: string;
  position: number;
  externalId: string;
  name: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  price: string | null;
  currency: string | null;
  image: string | null;
  merchantUrl: string | null;
  confidence: number | null;
  extractionMethod: ContentExtractionMethod;
  sources: string[];
  evidence: Record<string, unknown>;
  processorVersion: string;
  catalogProductId: string | null;
  discoveredProductId: string | null;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
};

export type InsertContentSourceProductRow = Omit<
  ContentSourceProductRecord,
  'id' | 'createdAt' | 'updatedAt' | 'schemaVersion' | 'catalogProductId' | 'discoveredProductId'
> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  schemaVersion?: number;
  catalogProductId?: string | null;
  discoveredProductId?: string | null;
};

export type VideoExtractionPortResult = {
  products: Array<{
    name: string;
    category?: string | null;
    brand?: string | null;
    model?: string | null;
    confidence?: number | null;
    evidence?: unknown;
    sources?: string[];
    price?: string | null;
    currency?: string | null;
    merchantUrl?: string | null;
    image?: string | null;
    externalId?: string | null;
    sortOrder?: number | null;
  }>;
  cacheHit: boolean;
  /** Successful extract with zero products is not a failure. */
  empty: boolean;
  finalStage: string;
  extractionMethod: ContentExtractionMethod;
};

export type WebEnrichmentPortResult = {
  candidate: {
    name: string;
    brand: string | null;
    category: string | null;
    price: string | null;
    currency: string | null;
    image: string | null;
    merchantUrl: string;
    evidence: Record<string, unknown>;
  } | null;
  empty: boolean;
};

