/**
 * User Import domain types — "this user shared this URL".
 *
 * User Import owns submission SoT only. It never owns product identity (Catalog),
 * content/source identity, or Bag membership (Cart).
 */

/** Submission acknowledgement. Processing lives on content_sources, not here. */
export type UserImportStatus = 'RECEIVED';

export type UserImportRecord = {
  id: string;
  userId: string;
  rawInput: string;
  sourceUrl: string;
  normalizedUrl: string;
  dedupeKey: string;
  platform: string;
  /** Global content identity. NULL only for pre-Phase-2 rows. */
  contentSourceId: string | null;
  status: UserImportStatus;
  /** When set, user-facing state is frozen at couldnt_finish. */
  timedOutAt: string | null;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
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
  importId: string;
  state: 'looking' | 'ready' | 'nothing_yet' | 'couldnt_finish';
  kind: 'instagram' | 'youtube' | 'web';
  createdAt: string;
  /** Candidate count when READY and not timed out; otherwise 0. */
  productCount: number;
  contentSourceId: string | null;
  /** Original shared / source URL for Your Shares expanded view. */
  sourceUrl: string;
  /** Display + single-product nav only; never navigate here when productCount >= 2. */
  primaryProduct: ShareProgressPrimaryProduct | null;
  /** Bound products for expanded Your Shares (empty when none / still looking / timed out). */
  products: ShareProgressPrimaryProduct[];
};
