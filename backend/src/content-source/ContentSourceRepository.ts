import type {
  ContentSourceIdentity,
  ContentSourceProductRecord,
  ContentSourceRecord,
  InsertContentSourceProductRow,
  InsertContentSourceRow,
} from './domain/types';

export type ContentSourceRepository = {
  findById(id: string): Promise<ContentSourceRecord | null>;
  findByIdentity(
    identity: Pick<ContentSourceIdentity, 'platform' | 'externalId'>,
  ): Promise<ContentSourceRecord | null>;
  /** Throws a `23505`-shaped error when `(platform, external_id)` already exists. */
  insert(row: InsertContentSourceRow): Promise<ContentSourceRecord>;
  /**
   * Display metadata only. Never changes processing_status or product rows.
   */
  patchDisplay(
    id: string,
    patch: { title?: string | null; thumbnailUrl?: string | null; publishedAt?: string | null },
  ): Promise<ContentSourceRecord | null>;
  /**
   * Atomic compare-and-set into QUEUED, applied only from an enqueueable status.
   * Returns null when another writer already moved the row on.
   */
  markQueued(id: string, queuedAt: string): Promise<ContentSourceRecord | null>;
  /**
   * Explicit retry: RECEIVED | FAILED | READY → QUEUED.
   * Does not claim PROCESSING/QUEUED rows.
   */
  markRequeue(id: string, queuedAt: string): Promise<ContentSourceRecord | null>;
  /**
   * Revert a failed enqueue so the source stays re-enqueueable.
   * Only QUEUED → RECEIVED (never touches PROCESSING/READY/FAILED).
   */
  markRevertToReceived(id: string): Promise<ContentSourceRecord | null>;
  /**
   * Claim the row for extraction. Applied from QUEUED (first start) or PROCESSING (retry).
   * Returns null when the row is READY / RECEIVED / FAILED (not claimable).
   */
  markProcessing(id: string): Promise<ContentSourceRecord | null>;
  markReady(
    id: string,
    params: { lastProcessedAt: string; candidateCount: number },
  ): Promise<ContentSourceRecord | null>;
  markFailed(
    id: string,
    params: { lastProcessedAt: string; reason: string },
  ): Promise<ContentSourceRecord | null>;
  replaceProducts(
    contentSourceId: string,
    rows: InsertContentSourceProductRow[],
  ): Promise<ContentSourceProductRecord[]>;
  listProducts(contentSourceId: string): Promise<ContentSourceProductRecord[]>;
  findProductByExternalId(
    contentSourceId: string,
    externalId: string,
  ): Promise<ContentSourceProductRecord | null>;
  insertProduct(row: InsertContentSourceProductRow): Promise<ContentSourceProductRecord>;
  deleteProduct(contentSourceId: string, productId: string): Promise<boolean>;
  bindProductResolution(
    productId: string,
    bind: {
      catalogProductId: string | null;
      discoveredProductId: string | null;
      image?: string | null;
    },
  ): Promise<ContentSourceProductRecord | null>;
  /** Content sources that already bound this catalogue or discovered product. */
  listBoundSourceIds(bind: {
    catalogProductId?: string | null;
    discoveredProductId?: string | null;
  }): Promise<string[]>;
};
