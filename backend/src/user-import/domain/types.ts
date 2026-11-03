import type { FindOutcome, StashSyncState } from '../find/outcome';
/**
 * User Import domain types — "this user shared this URL".
 *
 * User Import owns submission SoT only. It never owns product identity (Catalog),
 * content/source identity, or Bag membership (Cart).
 */

/** Submission acknowledgement. Processing lives on content_sources, not here. */
export type UserImportStatus = 'RECEIVED';

export type UserImportRecord = {
  stashSyncState?: StashSyncState | null;
  stashSyncAttemptId?: string | null;
  id: string;
  userId: string;
  rawInput: string | null;
  sourceUrl: string | null;
  normalizedUrl: string | null;
  dedupeKey: string;
  platform: string;
  /** Global content identity. NULL only for pre-Phase-2 rows. */
  contentSourceId: string | null;
  status: UserImportStatus;
  /** Historical delay marker; never overrides current processing facts. */
  timedOutAt: string | null;
  attemptStartedAt?: string | null;
  hiddenAt?: string | null;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
  interestKind?: 'product' | 'place' | 'both' | null;
  interestNote?: string | null;
  intentRevision?: number;
};

export type SubmitUserImportInput = {
  /** Raw shared URL or the text the URL was shared inside. */
  rawInput: string;
};

export type SubmitUserImportResult = {
  record: UserImportRecord;
  created: boolean;
};

export type InsertUserImportRow = {
  userId: string;
  rawInput: string;
  sourceUrl: string;
  normalizedUrl: string;
  dedupeKey: string;
  platform: string;
  contentSourceId: string | null;
  status: UserImportStatus;
};

/** User-facing primary product for Activity/Shares display + single-product nav. */
export type ShareProgressPrimaryProduct = {
  /** catalogProductId ?? discoveredProductId — Product Page accepts both. */
  productId: string;
  title: string;
  imageUrl: string | null;
};

/** Bag + Activity share progress. No queue or resolver vocabulary. */
export type ShareProgressItem = {
  /** Authoritative outcome. Other status/count fields are presentation aliases. */
  findOutcome: FindOutcome;
  /** Screen aliases, derived from findOutcome. */
  resultVersion?: 1;
  timedOut?: boolean;
  resultProductCount?: number;
  resultProducts?: ShareProgressPrimaryProduct[];
  placeCount?: number;
  resolvedPlaceCount?: number;
  unverifiedPlaceCount?: number;
  productStatus?: 'running' | 'complete' | 'failed' | 'unknown';
  placeStatus?: 'running' | 'complete' | 'failed' | 'unknown';
  hasInFlight?: boolean;
  canRetry?: boolean;
  importId: string;
  state: 'looking' | 'ready' | 'nothing_yet' | 'couldnt_finish';
  kind: 'instagram' | 'youtube' | 'web';
  createdAt: string;
  /** Authoritative found-product count, including partial results. */
  productCount: number;
  contentSourceId: string | null;
  /** Original shared / source URL for Your Shares expanded view. */
  sourceUrl: string;
  /** Display + single-product nav only; never navigate here when productCount >= 2. */
  primaryProduct: ShareProgressPrimaryProduct | null;
  /** Available bound product previews, including partial results. */
  products: ShareProgressPrimaryProduct[];
};
