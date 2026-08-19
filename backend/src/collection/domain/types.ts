/** Collection domain types — mirrors COLLECTION_DOMAIN_SPEC.md §2–§4. */

export const COLLECTION_SCHEMA_VERSION = 1;

export type CollectionStatus =
  | 'draft'
  | 'processing'
  | 'ready_for_review'
  | 'review_required'
  | 'rejected'
  | 'published'
  | 'unpublished'
  | 'archived'
  | 'deleted';

export type CollectionVisibility = 'public' | 'unlisted' | 'private';

export type RecommendationIntentSource = 'ai' | 'creator' | 'hybrid' | 'system';

export type ModerationState = 'clear' | 'needs_review' | 'rejected' | 'takedown';

export type CollectionOriginType =
  | 'url_ingest'
  | 'manual_curation'
  | 'native_upload'
  | 'import_instagram'
  | 'import_pinterest'
  | 'ai_generated';

export type MediaKind = 'video' | 'image' | 'link';

export type MediaProcessingStatus =
  | 'imported'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'archived';

export type SourceAvailability = 'unknown' | 'available' | 'unavailable' | 'restricted';

export type PipelineFacetStatus =
  | 'not_started'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'unavailable';

/** @deprecated Use MediaKind — kept only if referenced during transition. */
export type MediaType = MediaKind | 'video_external' | 'video_native' | 'pdf';

export type TagSource = 'ai' | 'manual' | 'import';

/** Frozen selection_source enum (canonical). */
export type SelectionSource =
  | 'AI_DETECTED'
  | 'AI_RECOMMENDED'
  | 'CREATOR_MANUAL'
  | 'CREATOR_ACCEPTED_AI'
  | 'IMPORT'
  | 'SYSTEM';

/** V1 writers: PRIMARY | SECONDARY. Future values reserved in DB. */
export type RecommendationStrength =
  | 'PRIMARY'
  | 'SECONDARY'
  | 'BEST_OVERALL'
  | 'RUNNER_UP'
  | 'BUDGET_PICK'
  | 'ALTERNATIVE'
  | 'AVOID';

export type TagStatus =
  | 'proposed'
  | 'accepted'
  | 'rejected'
  | 'published'
  | 'archived'
  | 'deleted';

export type TagVisibility = 'visible' | 'hidden';

export type CreatorTagAction =
  | 'none'
  | 'accepted'
  | 'rejected'
  | 'removed'
  | 'reordered'
  | 'edited'
  | 'added_manual'
  | 'note_edited';

export type ResolutionStatus = 'VERIFIED' | 'UNVERIFIED' | 'UNRESOLVED';

export const CREATOR_NOTE_MAX_LENGTH = 500;

export function mapLegacyTagSource(tagSource: TagSource): SelectionSource {
  if (tagSource === 'manual') return 'CREATOR_MANUAL';
  if (tagSource === 'import') return 'IMPORT';
  return 'AI_DETECTED';
}

export function toLegacyTagSource(selection: SelectionSource): TagSource {
  if (selection === 'CREATOR_MANUAL') return 'manual';
  if (selection === 'IMPORT') return 'import';
  return 'ai';
}

/** Extensible controlled vocabulary (format + use-context). */
export const RECOMMENDATION_INTENTS = [
  'review',
  'first_impression',
  'comparison',
  'buying_guide',
  'best_of',
  'favorites',
  'setup',
  'gift_guide',
  'budget_pick',
  'premium_pick',
  'everyday_carry',
  'travel',
  'gaming',
  'photography',
  'workspace',
] as const;

export type RecommendationIntent = (typeof RECOMMENDATION_INTENTS)[number] | string;

export type CreatorSnapshot = {
  creatorName: string | null;
  creatorUsername: string | null;
  creatorAvatar: string | null;
  creatorVerified: boolean;
  creatorSnapshotUpdatedAt: string | null;
};

export type SearchSourceFields = {
  searchTitle: string | null;
  searchText: string | null;
  searchKeywords: string[];
  searchBrands: string[];
  searchCategories: string[];
  searchSourceUpdatedAt: string | null;
};

export type MaterializedCounters = {
  viewsCount: number;
  likesCount: number;
  savesCount: number;
  sharesCount: number;
  productClicksCount: number;
  purchasesCount: number;
  countersUpdatedAt: string | null;
};

export type QualitySignals = {
  qualityScore: number | null;
  commerceScore: number | null;
  searchScore: number | null;
  recommendationScore: number | null;
  trustScore: number | null;
  qualitySignalsUpdatedAt: string | null;
};

export type Collection = {
  id: string;
  slug: string;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
  status: CollectionStatus;
  visibility: CollectionVisibility;
  publishedAt: string | null;
  unpublishedAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  contentRevision: number;
  title: string | null;
  caption: string | null;
  language: string | null;
  primaryLocale: string | null;
  recommendationIntent: string | null;
  recommendationIntentsSecondary: string[];
  recommendationIntentSource: RecommendationIntentSource | null;
  recommendationIntentConfidence: number | null;
  creatorName: string | null;
  creatorUsername: string | null;
  creatorAvatar: string | null;
  creatorVerified: boolean;
  creatorSnapshotUpdatedAt: string | null;
  primaryMediaId: string | null;
  mediaCount: number;
  heroThumbnailUrl: string | null;
  primaryProductTagId: string | null;
  productTagCount: number;
  primaryProductNameSnapshot: string | null;
  searchTitle: string | null;
  searchText: string | null;
  searchKeywords: string[];
  searchBrands: string[];
  searchCategories: string[];
  searchSourceUpdatedAt: string | null;
  viewsCount: number;
  likesCount: number;
  savesCount: number;
  sharesCount: number;
  productClicksCount: number;
  purchasesCount: number;
  countersUpdatedAt: string | null;
  qualityScore: number | null;
  commerceScore: number | null;
  searchScore: number | null;
  recommendationScore: number | null;
  trustScore: number | null;
  qualitySignalsUpdatedAt: string | null;
  feedEligible: boolean;
  searchEligible: boolean;
  recsEligible: boolean;
  moderationState: ModerationState;
  moderationNotesRef: string | null;
  originType: CollectionOriginType;
  originPlatform: string | null;
  originSourceUrl: string | null;
  latestIngestRunId: string | null;
  schemaVersion: number;
  extensions: Record<string, unknown>;
};

export type CollectionMedia = {
  id: string;
  collectionId: string;
  isPrimary: boolean;
  sourceProvider: string | null;
  mediaKind: MediaKind;
  externalId: string | null;
  canonicalUrl: string | null;
  sourceUrl: string | null;
  embedUrl: string | null;
  title: string | null;
  providerCreatorId: string | null;
  providerCreatorName: string | null;
  thumbnailUrl: string | null;
  durationMs: number | null;
  aspectRatio: string | null;
  language: string | null;
  region: string | null;
  sourcePublishedAt: string | null;
  sourceAvailability: SourceAvailability;
  processingStatus: MediaProcessingStatus;
  transcriptStatus: PipelineFacetStatus;
  mediaUnderstandingStatus: PipelineFacetStatus;
  latestProcessingJobId: string | null;
  latestArtifactBundleRef: string | null;
  providerMetadataVersion: string | null;
  lastMetadataSyncedAt: string | null;
  lastProcessedAt: string | null;
  lastProcessingErrorCode: string | null;
  processingAttemptCount: number;
  schemaVersion: number;
  extensions: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CollectionProductTag = {
  id: string;
  collectionId: string;
  catalogProductId: string | null;
  sortOrder: number;
  /** Synced denorm: true iff recommendationStrength === PRIMARY */
  isPrimary: boolean;
  recommendationStrength: RecommendationStrength;
  /** @deprecated Prefer selectionSource — kept for back-compat */
  tagSource: TagSource;
  selectionSource: SelectionSource;
  tagStatus: TagStatus;
  visibility: TagVisibility;
  creatorNote: string | null;
  creatorAction: CreatorTagAction | null;
  detectionSource: string | null;
  reason: string | null;
  evidenceRefs: unknown[];
  recommendedBy: string | null;
  confidence: number | null;
  frameCues: unknown[];
  includeInPublish: boolean;
  nameSnapshot: string | null;
  imageSnapshot: string | null;
  brandSnapshot: string | null;
  categorySnapshot: string | null;
  snapshotUpdatedAt: string | null;
  resolutionStatus: ResolutionStatus | null;
  externalId: string | null;
  merchantUrl: string | null;
  acceptedAt: string | null;
  firstPublishedAt: string | null;
  rejectedAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function isPrimaryTag(
  tag: Pick<CollectionProductTag, 'recommendationStrength' | 'isPrimary'>,
): boolean {
  return tag.recommendationStrength === 'PRIMARY' || tag.isPrimary;
}

/** Visible + included + not deleted/rejected — used for publish surface & product_tag_count. */
export function isPublishSurfaceTag(
  tag: Pick<
    CollectionProductTag,
    'visibility' | 'includeInPublish' | 'tagStatus' | 'deletedAt'
  >,
): boolean {
  if (tag.deletedAt) return false;
  if (tag.tagStatus === 'deleted' || tag.tagStatus === 'rejected' || tag.tagStatus === 'archived') {
    return false;
  }
  return tag.visibility === 'visible' && tag.includeInPublish;
}

export type CollectionAggregate = {
  collection: Collection;
  media: CollectionMedia[];
  tags: CollectionProductTag[];
};
