import type {
  Collection,
  CollectionAggregate,
  CollectionMedia,
  CollectionProductTag,
  CollectionStatus,
  CollectionVisibility,
  MaterializedCounters,
  QualitySignals,
  SearchSourceFields,
} from './domain/types';

export type CreateCollectionInput = {
  id?: string;
  slug: string;
  creatorId: string;
  status?: CollectionStatus;
  visibility?: CollectionVisibility;
  title?: string | null;
  caption?: string | null;
  originType: Collection['originType'];
  originPlatform?: string | null;
  originSourceUrl?: string | null;
  qualityScore?: number | null;
  creatorName?: string | null;
  creatorUsername?: string | null;
  creatorAvatar?: string | null;
  creatorVerified?: boolean;
  creatorSnapshotUpdatedAt?: string | null;
  latestIngestRunId?: string | null;
};

export type UpdateCollectionPatch = Partial<
  Omit<Collection, 'id' | 'creatorId' | 'createdAt' | 'slug'>
> & { slug?: string };

export type CreateMediaInput = {
  id?: string;
  collectionId: string;
  isPrimary?: boolean;
  sourceProvider?: string | null;
  mediaKind?: CollectionMedia['mediaKind'];
  externalId?: string | null;
  canonicalUrl?: string | null;
  sourceUrl?: string | null;
  embedUrl?: string | null;
  title?: string | null;
  providerCreatorId?: string | null;
  providerCreatorName?: string | null;
  thumbnailUrl?: string | null;
  durationMs?: number | null;
  aspectRatio?: string | null;
  language?: string | null;
  region?: string | null;
  sourcePublishedAt?: string | null;
  sourceAvailability?: CollectionMedia['sourceAvailability'];
  processingStatus?: CollectionMedia['processingStatus'];
  transcriptStatus?: CollectionMedia['transcriptStatus'];
  mediaUnderstandingStatus?: CollectionMedia['mediaUnderstandingStatus'];
  latestProcessingJobId?: string | null;
  latestArtifactBundleRef?: string | null;
  providerMetadataVersion?: string | null;
  lastMetadataSyncedAt?: string | null;
  lastProcessedAt?: string | null;
  lastProcessingErrorCode?: string | null;
  processingAttemptCount?: number;
  schemaVersion?: number;
  extensions?: Record<string, unknown>;
};

export type CreateTagInput = {
  id?: string;
  collectionId: string;
  catalogProductId?: string | null;
  sortOrder?: number;
  isPrimary?: boolean;
  recommendationStrength?: CollectionProductTag['recommendationStrength'];
  tagSource?: CollectionProductTag['tagSource'];
  selectionSource?: CollectionProductTag['selectionSource'];
  tagStatus?: CollectionProductTag['tagStatus'];
  visibility?: CollectionProductTag['visibility'];
  creatorNote?: string | null;
  creatorAction?: CollectionProductTag['creatorAction'];
  detectionSource?: string | null;
  reason?: string | null;
  evidenceRefs?: unknown[];
  recommendedBy?: string | null;
  confidence?: number | null;
  frameCues?: unknown[];
  includeInPublish?: boolean;
  nameSnapshot?: string | null;
  imageSnapshot?: string | null;
  brandSnapshot?: string | null;
  categorySnapshot?: string | null;
  snapshotUpdatedAt?: string | null;
  resolutionStatus?: CollectionProductTag['resolutionStatus'];
  externalId?: string | null;
  merchantUrl?: string | null;
  acceptedAt?: string | null;
  firstPublishedAt?: string | null;
};

export type UpdateTagPatch = Partial<
  Omit<CollectionProductTag, 'id' | 'collectionId' | 'createdAt'>
>;

export interface CollectionRepository {
  insertCollection(input: CreateCollectionInput): Promise<Collection>;
  getCollection(id: string): Promise<Collection | null>;
  getCollectionBySlug(slug: string): Promise<Collection | null>;
  updateCollection(id: string, patch: UpdateCollectionPatch): Promise<Collection>;
  getAggregate(id: string): Promise<CollectionAggregate | null>;

  insertMedia(input: CreateMediaInput): Promise<CollectionMedia>;
  listMedia(collectionId: string): Promise<CollectionMedia[]>;
  updateMedia(
    id: string,
    patch: Partial<Omit<CollectionMedia, 'id' | 'collectionId' | 'createdAt'>>,
  ): Promise<CollectionMedia>;
  deleteMedia(id: string): Promise<void>;

  insertTag(input: CreateTagInput): Promise<CollectionProductTag>;
  listTags(collectionId: string, opts?: { includeDeleted?: boolean }): Promise<CollectionProductTag[]>;
  /** All non-deleted tags pointing at a Catalog product (for merge remapping). */
  listTagsByCatalogProductId(catalogProductId: string): Promise<CollectionProductTag[]>;
  updateTag(id: string, patch: UpdateTagPatch): Promise<CollectionProductTag>;
  deleteTag(id: string): Promise<void>;
  replaceProposedTags(collectionId: string, tags: CreateTagInput[]): Promise<CollectionProductTag[]>;

  applySearchSource(id: string, fields: SearchSourceFields): Promise<void>;
  applyCounters(id: string, counters: Partial<MaterializedCounters>): Promise<void>;
  applyQualitySignals(id: string, signals: Partial<QualitySignals>): Promise<void>;

  /** Soft-deleted User: hide owned Collections from public discovery (ownership unchanged). */
  hideCreatorFromDiscovery(creatorId: string): Promise<void>;
  /** Restored User: re-enable discovery flags only for published+public+clear Collections. */
  restoreCreatorDiscovery(creatorId: string): Promise<void>;

  /**
   * Public Creator Profile grid: published + public + clear + not deleted.
   * Sorted published_at DESC, id DESC. Keyset cursor.
   */
  listPublishedPublicByCreator(
    creatorId: string,
    opts: { limit: number; cursor?: { publishedAt: string; id: string } | null },
  ): Promise<Collection[]>;

  /** Sum saves_count for published+public+clear+not-deleted Collections. */
  sumPublishedCollectionSaves(creatorId: string): Promise<number>;

  /**
   * Publish-surface product tags on published+public+clear Collections for a creator.
   * Ordered by catalog_product_id ASC. Keyset: catalog_product_id > afterCatalogProductId.
   */
  listPublishedCreatorProductTagRows(
    creatorId: string,
    opts: { limit: number; afterCatalogProductId?: string | null },
  ): Promise<PublishedCreatorProductTagRow[]>;
}

/** Join row for creator product listing (tag snapshot + representative Collection). */
export type PublishedCreatorProductTagRow = {
  catalogProductId: string;
  nameSnapshot: string | null;
  imageSnapshot: string | null;
  brandSnapshot: string | null;
  resolutionStatus: CollectionProductTag['resolutionStatus'];
  collectionId: string;
  collectionTitle: string | null;
};
