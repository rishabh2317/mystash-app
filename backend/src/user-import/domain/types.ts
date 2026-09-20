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

/** Bag-facing share progress. No queue or resolver vocabulary. */
export type ShareProgressItem = {
  importId: string;
  state: 'looking' | 'ready' | 'nothing_yet' | 'couldnt_finish';
  kind: 'instagram' | 'youtube' | 'web';
};
