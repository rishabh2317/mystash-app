import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CollectionRepository,
  CreateCollectionInput,
  CreateMediaInput,
  CreateTagInput,
  PublishedCreatorProductTagRow,
  UpdateCollectionPatch,
  UpdateTagPatch,
} from './CollectionRepository';
import type {
  Collection,
  CollectionAggregate,
  CollectionMedia,
  CollectionProductTag,
  MaterializedCounters,
  QualitySignals,
  SearchSourceFields,
  TagSource,
} from './domain/types';
import {
  COLLECTION_SCHEMA_VERSION,
  mapLegacyTagSource,
  toLegacyTagSource,
} from './domain/types';

type Row = Record<string, unknown>;

function mapCollection(row: Row): Collection {
  return {
    id: String(row.id),
    slug: String(row.slug),
    creatorId: String(row.creator_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    status: row.status as Collection['status'],
    visibility: row.visibility as Collection['visibility'],
    publishedAt: (row.published_at as string) ?? null,
    unpublishedAt: (row.unpublished_at as string) ?? null,
    archivedAt: (row.archived_at as string) ?? null,
    deletedAt: (row.deleted_at as string) ?? null,
    contentRevision: Number(row.content_revision) || 0,
    title: (row.title as string) ?? null,
    caption: (row.caption as string) ?? null,
    language: (row.language as string) ?? null,
    primaryLocale: (row.primary_locale as string) ?? null,
    recommendationIntent: (row.recommendation_intent as string) ?? null,
    recommendationIntentsSecondary: (row.recommendation_intents_secondary as string[]) ?? [],
    recommendationIntentSource:
      (row.recommendation_intent_source as Collection['recommendationIntentSource']) ?? null,
    recommendationIntentConfidence:
      row.recommendation_intent_confidence == null
        ? null
        : Number(row.recommendation_intent_confidence),
    creatorName: (row.creator_name as string) ?? null,
    creatorUsername: (row.creator_username as string) ?? null,
    creatorAvatar: (row.creator_avatar as string) ?? null,
    creatorVerified: Boolean(row.creator_verified),
    creatorSnapshotUpdatedAt: (row.creator_snapshot_updated_at as string) ?? null,
    primaryMediaId: (row.primary_media_id as string) ?? null,
    mediaCount: Number(row.media_count) || 0,
    heroThumbnailUrl: (row.hero_thumbnail_url as string) ?? null,
    primaryProductTagId: (row.primary_product_tag_id as string) ?? null,
    productTagCount: Number(row.product_tag_count) || 0,
    primaryProductNameSnapshot: (row.primary_product_name_snapshot as string) ?? null,
    searchTitle: (row.search_title as string) ?? null,
    searchText: (row.search_text as string) ?? null,
    searchKeywords: (row.search_keywords as string[]) ?? [],
    searchBrands: (row.search_brands as string[]) ?? [],
    searchCategories: (row.search_categories as string[]) ?? [],
    searchSourceUpdatedAt: (row.search_source_updated_at as string) ?? null,
    viewsCount: Number(row.views_count) || 0,
    likesCount: Number(row.likes_count) || 0,
    savesCount: Number(row.saves_count) || 0,
    sharesCount: Number(row.shares_count) || 0,
    productClicksCount: Number(row.product_clicks_count) || 0,
    purchasesCount: Number(row.purchases_count) || 0,
    countersUpdatedAt: (row.counters_updated_at as string) ?? null,
    qualityScore: row.quality_score == null ? null : Number(row.quality_score),
    commerceScore: row.commerce_score == null ? null : Number(row.commerce_score),
    searchScore: row.search_score == null ? null : Number(row.search_score),
    recommendationScore:
      row.recommendation_score == null ? null : Number(row.recommendation_score),
    trustScore: row.trust_score == null ? null : Number(row.trust_score),
    qualitySignalsUpdatedAt: (row.quality_signals_updated_at as string) ?? null,
    feedEligible: Boolean(row.feed_eligible),
    searchEligible: Boolean(row.search_eligible),
    recsEligible: Boolean(row.recs_eligible),
    moderationState: row.moderation_state as Collection['moderationState'],
    moderationNotesRef: (row.moderation_notes_ref as string) ?? null,
    originType: row.origin_type as Collection['originType'],
    originPlatform: (row.origin_platform as string) ?? null,
    originSourceUrl: (row.origin_source_url as string) ?? null,
    latestIngestRunId: (row.latest_ingest_run_id as string) ?? null,
    schemaVersion: Number(row.schema_version) || COLLECTION_SCHEMA_VERSION,
    extensions: (row.extensions as Record<string, unknown>) ?? {},
  };
}

function mapMedia(row: Row): CollectionMedia {
  const legacyType = row.media_type as string | undefined;
  let mediaKind = (row.media_kind as CollectionMedia['mediaKind']) ?? 'video';
  if (!row.media_kind && legacyType) {
    if (legacyType === 'image') mediaKind = 'image';
    else if (legacyType === 'link' || legacyType === 'pdf') mediaKind = 'link';
    else mediaKind = 'video';
  }
  return {
    id: String(row.id),
    collectionId: String(row.collection_id),
    isPrimary: Boolean(row.is_primary),
    sourceProvider: (row.source_provider as string) ?? null,
    mediaKind,
    externalId: (row.external_id as string) ?? null,
    canonicalUrl: (row.canonical_url as string) ?? null,
    sourceUrl: (row.source_url as string) ?? null,
    embedUrl: (row.embed_url as string) ?? null,
    title: (row.title as string) ?? null,
    providerCreatorId: (row.provider_creator_id as string) ?? null,
    providerCreatorName: (row.provider_creator_name as string) ?? null,
    thumbnailUrl: (row.thumbnail_url as string) ?? null,
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    aspectRatio: (row.aspect_ratio as string) ?? null,
    language: (row.language as string) ?? null,
    region: (row.region as string) ?? null,
    sourcePublishedAt: (row.source_published_at as string) ?? null,
    sourceAvailability:
      (row.source_availability as CollectionMedia['sourceAvailability']) ?? 'unknown',
    processingStatus: (row.processing_status as CollectionMedia['processingStatus']) ?? 'imported',
    transcriptStatus:
      (row.transcript_status as CollectionMedia['transcriptStatus']) ?? 'not_started',
    mediaUnderstandingStatus:
      (row.media_understanding_status as CollectionMedia['mediaUnderstandingStatus']) ??
      'not_started',
    latestProcessingJobId: (row.latest_processing_job_id as string) ?? null,
    latestArtifactBundleRef: (row.latest_artifact_bundle_ref as string) ?? null,
    providerMetadataVersion: (row.provider_metadata_version as string) ?? null,
    lastMetadataSyncedAt: (row.last_metadata_synced_at as string) ?? null,
    lastProcessedAt: (row.last_processed_at as string) ?? null,
    lastProcessingErrorCode: (row.last_processing_error_code as string) ?? null,
    processingAttemptCount: Number(row.processing_attempt_count) || 0,
    schemaVersion: Number(row.schema_version) || 1,
    extensions: (row.extensions as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mediaPatchToRow(
  patch: Partial<Omit<CollectionMedia, 'id' | 'collectionId' | 'createdAt'>>,
): Row {
  const row: Row = { updated_at: new Date().toISOString() };
  const map: Record<string, string> = {
    isPrimary: 'is_primary',
    sourceProvider: 'source_provider',
    mediaKind: 'media_kind',
    externalId: 'external_id',
    canonicalUrl: 'canonical_url',
    sourceUrl: 'source_url',
    embedUrl: 'embed_url',
    title: 'title',
    providerCreatorId: 'provider_creator_id',
    providerCreatorName: 'provider_creator_name',
    thumbnailUrl: 'thumbnail_url',
    durationMs: 'duration_ms',
    aspectRatio: 'aspect_ratio',
    language: 'language',
    region: 'region',
    sourcePublishedAt: 'source_published_at',
    sourceAvailability: 'source_availability',
    processingStatus: 'processing_status',
    transcriptStatus: 'transcript_status',
    mediaUnderstandingStatus: 'media_understanding_status',
    latestProcessingJobId: 'latest_processing_job_id',
    latestArtifactBundleRef: 'latest_artifact_bundle_ref',
    providerMetadataVersion: 'provider_metadata_version',
    lastMetadataSyncedAt: 'last_metadata_synced_at',
    lastProcessedAt: 'last_processed_at',
    lastProcessingErrorCode: 'last_processing_error_code',
    processingAttemptCount: 'processing_attempt_count',
    schemaVersion: 'schema_version',
    extensions: 'extensions',
  };
  for (const [k, col] of Object.entries(map)) {
    if (k in patch) row[col] = (patch as Record<string, unknown>)[k];
  }
  return row;
}

function mapTag(row: Row): CollectionProductTag {
  const selection =
    (row.selection_source as CollectionProductTag['selectionSource'] | undefined) ??
    mapLegacyTagSource((row.tag_source as TagSource) ?? 'ai');
  const strength =
    (row.recommendation_strength as CollectionProductTag['recommendationStrength'] | undefined) ??
    (row.is_primary ? 'PRIMARY' : 'SECONDARY');
  return {
    id: String(row.id),
    collectionId: String(row.collection_id),
    catalogProductId: (row.catalog_product_id as string) ?? null,
    sortOrder: Number(row.sort_order) || 0,
    isPrimary: strength === 'PRIMARY' || Boolean(row.is_primary),
    recommendationStrength: strength,
    tagSource: (row.tag_source as CollectionProductTag['tagSource']) ?? toLegacyTagSource(selection),
    selectionSource: selection,
    tagStatus: (row.tag_status as CollectionProductTag['tagStatus']) ?? 'proposed',
    visibility: (row.visibility as CollectionProductTag['visibility']) ?? 'visible',
    creatorNote: (row.creator_note as string) ?? null,
    creatorAction: (row.creator_action as CollectionProductTag['creatorAction']) ?? null,
    detectionSource: (row.detection_source as string) ?? null,
    reason: (row.reason as string) ?? null,
    evidenceRefs: Array.isArray(row.evidence_refs) ? (row.evidence_refs as unknown[]) : [],
    recommendedBy: (row.recommended_by as string) ?? null,
    confidence: row.confidence == null ? null : Number(row.confidence),
    frameCues: Array.isArray(row.frame_cues) ? (row.frame_cues as unknown[]) : [],
    includeInPublish: row.include_in_publish !== false,
    nameSnapshot: (row.name_snapshot as string) ?? null,
    imageSnapshot: (row.image_snapshot as string) ?? null,
    brandSnapshot: (row.brand_snapshot as string) ?? null,
    categorySnapshot: (row.category_snapshot as string) ?? null,
    snapshotUpdatedAt: (row.snapshot_updated_at as string) ?? null,
    resolutionStatus: (row.resolution_status as CollectionProductTag['resolutionStatus']) ?? null,
    externalId: (row.external_id as string) ?? null,
    merchantUrl: (row.merchant_url as string) ?? null,
    acceptedAt: (row.accepted_at as string) ?? null,
    firstPublishedAt: (row.first_published_at as string) ?? null,
    rejectedAt: (row.rejected_at as string) ?? null,
    archivedAt: (row.archived_at as string) ?? null,
    deletedAt: (row.deleted_at as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function collectionPatchToRow(patch: UpdateCollectionPatch): Row {
  const row: Row = { updated_at: new Date().toISOString() };
  const map: Record<string, string> = {
    slug: 'slug',
    status: 'status',
    visibility: 'visibility',
    publishedAt: 'published_at',
    unpublishedAt: 'unpublished_at',
    archivedAt: 'archived_at',
    deletedAt: 'deleted_at',
    contentRevision: 'content_revision',
    title: 'title',
    caption: 'caption',
    language: 'language',
    primaryLocale: 'primary_locale',
    recommendationIntent: 'recommendation_intent',
    recommendationIntentsSecondary: 'recommendation_intents_secondary',
    recommendationIntentSource: 'recommendation_intent_source',
    recommendationIntentConfidence: 'recommendation_intent_confidence',
    creatorName: 'creator_name',
    creatorUsername: 'creator_username',
    creatorAvatar: 'creator_avatar',
    creatorVerified: 'creator_verified',
    creatorSnapshotUpdatedAt: 'creator_snapshot_updated_at',
    primaryMediaId: 'primary_media_id',
    mediaCount: 'media_count',
    heroThumbnailUrl: 'hero_thumbnail_url',
    primaryProductTagId: 'primary_product_tag_id',
    productTagCount: 'product_tag_count',
    primaryProductNameSnapshot: 'primary_product_name_snapshot',
    searchTitle: 'search_title',
    searchText: 'search_text',
    searchKeywords: 'search_keywords',
    searchBrands: 'search_brands',
    searchCategories: 'search_categories',
    searchSourceUpdatedAt: 'search_source_updated_at',
    viewsCount: 'views_count',
    likesCount: 'likes_count',
    savesCount: 'saves_count',
    sharesCount: 'shares_count',
    productClicksCount: 'product_clicks_count',
    purchasesCount: 'purchases_count',
    countersUpdatedAt: 'counters_updated_at',
    qualityScore: 'quality_score',
    commerceScore: 'commerce_score',
    searchScore: 'search_score',
    recommendationScore: 'recommendation_score',
    trustScore: 'trust_score',
    qualitySignalsUpdatedAt: 'quality_signals_updated_at',
    feedEligible: 'feed_eligible',
    searchEligible: 'search_eligible',
    recsEligible: 'recs_eligible',
    moderationState: 'moderation_state',
    moderationNotesRef: 'moderation_notes_ref',
    originType: 'origin_type',
    originPlatform: 'origin_platform',
    originSourceUrl: 'origin_source_url',
    latestIngestRunId: 'latest_ingest_run_id',
    schemaVersion: 'schema_version',
    extensions: 'extensions',
  };
  for (const [k, col] of Object.entries(map)) {
    if (k in patch) {
      row[col] = (patch as Record<string, unknown>)[k];
    }
  }
  return row;
}

export class SupabaseCollectionRepository implements CollectionRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async insertCollection(input: CreateCollectionInput): Promise<Collection> {
    const now = new Date().toISOString();
    const row: Row = {
      slug: input.slug,
      creator_id: input.creatorId,
      status: input.status ?? 'draft',
      visibility: input.visibility ?? 'private',
      title: input.title ?? null,
      caption: input.caption ?? null,
      origin_type: input.originType,
      origin_platform: input.originPlatform ?? null,
      origin_source_url: input.originSourceUrl ?? null,
      quality_score: input.qualityScore ?? null,
      creator_name: input.creatorName ?? null,
      creator_username: input.creatorUsername ?? null,
      creator_avatar: input.creatorAvatar ?? null,
      creator_verified: input.creatorVerified ?? false,
      creator_snapshot_updated_at: input.creatorSnapshotUpdatedAt ?? now,
      latest_ingest_run_id: input.latestIngestRunId ?? null,
      schema_version: COLLECTION_SCHEMA_VERSION,
      created_at: now,
      updated_at: now,
    };
    if (input.id) row.id = input.id;

    const { data, error } = await this.admin.from('collections').insert(row).select('*').single();
    if (error || !data) throw new Error(error?.message ?? 'Failed to insert collection');
    return mapCollection(data as Row);
  }

  async getCollection(id: string): Promise<Collection | null> {
    const { data } = await this.admin.from('collections').select('*').eq('id', id).maybeSingle();
    return data ? mapCollection(data as Row) : null;
  }

  async getCollectionBySlug(slug: string): Promise<Collection | null> {
    const { data } = await this.admin
      .from('collections')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();
    return data ? mapCollection(data as Row) : null;
  }

  async updateCollection(id: string, patch: UpdateCollectionPatch): Promise<Collection> {
    const { data, error } = await this.admin
      .from('collections')
      .update(collectionPatchToRow(patch))
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Failed to update collection');
    return mapCollection(data as Row);
  }

  async getAggregate(id: string): Promise<CollectionAggregate | null> {
    const collection = await this.getCollection(id);
    if (!collection) return null;
    const [media, tags] = await Promise.all([this.listMedia(id), this.listTags(id)]);
    return { collection, media, tags };
  }

  async insertMedia(input: CreateMediaInput): Promise<CollectionMedia> {
    const now = new Date().toISOString();
    const mediaKind = input.mediaKind ?? 'video';
    const row: Row = {
      collection_id: input.collectionId,
      media_type:
        mediaKind === 'image' ? 'image' : mediaKind === 'link' ? 'link' : 'video_external',
      media_kind: mediaKind,
      source_provider: input.sourceProvider ?? null,
      external_id: input.externalId ?? null,
      canonical_url: input.canonicalUrl ?? input.sourceUrl ?? null,
      source_url: input.sourceUrl ?? null,
      embed_url: input.embedUrl ?? null,
      title: input.title ?? null,
      provider_creator_id: input.providerCreatorId ?? null,
      provider_creator_name: input.providerCreatorName ?? null,
      thumbnail_url: input.thumbnailUrl ?? null,
      duration_ms: input.durationMs ?? null,
      aspect_ratio: input.aspectRatio ?? null,
      language: input.language ?? null,
      region: input.region ?? null,
      source_published_at: input.sourcePublishedAt ?? null,
      source_availability: input.sourceAvailability ?? 'unknown',
      processing_status: input.processingStatus ?? 'imported',
      transcript_status: input.transcriptStatus ?? 'not_started',
      media_understanding_status: input.mediaUnderstandingStatus ?? 'not_started',
      latest_processing_job_id: input.latestProcessingJobId ?? null,
      latest_artifact_bundle_ref: input.latestArtifactBundleRef ?? null,
      provider_metadata_version: input.providerMetadataVersion ?? null,
      last_metadata_synced_at: input.lastMetadataSyncedAt ?? null,
      last_processed_at: input.lastProcessedAt ?? null,
      last_processing_error_code: input.lastProcessingErrorCode ?? null,
      processing_attempt_count: input.processingAttemptCount ?? 0,
      schema_version: input.schemaVersion ?? 1,
      extensions: input.extensions ?? {},
      sort_order: 0,
      is_primary: input.isPrimary ?? true,
      created_at: now,
      updated_at: now,
    };
    if (input.id) row.id = input.id;
    const { data, error } = await this.admin
      .from('collection_media')
      .insert(row)
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Failed to insert media');
    return mapMedia(data as Row);
  }

  async listMedia(collectionId: string): Promise<CollectionMedia[]> {
    const { data } = await this.admin
      .from('collection_media')
      .select('*')
      .eq('collection_id', collectionId)
      .order('created_at', { ascending: true });
    return (data ?? []).map((r) => mapMedia(r as Row));
  }

  async updateMedia(
    id: string,
    patch: Partial<Omit<CollectionMedia, 'id' | 'collectionId' | 'createdAt'>>,
  ): Promise<CollectionMedia> {
    const { data, error } = await this.admin
      .from('collection_media')
      .update(mediaPatchToRow(patch))
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Failed to update media');
    return mapMedia(data as Row);
  }

  async deleteMedia(id: string): Promise<void> {
    const { error } = await this.admin.from('collection_media').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async insertTag(input: CreateTagInput): Promise<CollectionProductTag> {
    const now = new Date().toISOString();
    const strength =
      input.recommendationStrength ?? (input.isPrimary ? 'PRIMARY' : 'SECONDARY');
    const selection =
      input.selectionSource ??
      (input.tagSource ? mapLegacyTagSource(input.tagSource) : 'AI_DETECTED');
    const hasSnapshot = !!(
      input.nameSnapshot ||
      input.imageSnapshot ||
      input.brandSnapshot ||
      input.categorySnapshot
    );
    const row: Row = {
      collection_id: input.collectionId,
      catalog_product_id: input.catalogProductId ?? null,
      sort_order: input.sortOrder ?? 0,
      is_primary: strength === 'PRIMARY',
      recommendation_strength: strength,
      tag_source: input.tagSource ?? toLegacyTagSource(selection),
      selection_source: selection,
      tag_status: input.tagStatus ?? 'proposed',
      visibility: input.visibility ?? 'visible',
      creator_note: input.creatorNote ?? null,
      creator_action: input.creatorAction ?? null,
      detection_source: input.detectionSource ?? null,
      reason: input.reason ?? null,
      evidence_refs: input.evidenceRefs ?? [],
      recommended_by: input.recommendedBy ?? null,
      confidence: input.confidence ?? null,
      frame_cues: input.frameCues ?? [],
      include_in_publish: input.includeInPublish ?? true,
      name_snapshot: input.nameSnapshot ?? null,
      image_snapshot: input.imageSnapshot ?? null,
      brand_snapshot: input.brandSnapshot ?? null,
      category_snapshot: input.categorySnapshot ?? null,
      snapshot_updated_at: input.snapshotUpdatedAt ?? (hasSnapshot ? now : null),
      resolution_status: input.resolutionStatus ?? null,
      external_id: input.externalId ?? null,
      merchant_url: input.merchantUrl ?? null,
      accepted_at: input.acceptedAt ?? null,
      first_published_at: input.firstPublishedAt ?? null,
      created_at: now,
      updated_at: now,
    };
    if (input.id) row.id = input.id;
    const { data, error } = await this.admin
      .from('collection_product_tags')
      .insert(row)
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Failed to insert tag');
    return mapTag(data as Row);
  }

  async listTags(
    collectionId: string,
    opts?: { includeDeleted?: boolean },
  ): Promise<CollectionProductTag[]> {
    let q = this.admin
      .from('collection_product_tags')
      .select('*')
      .eq('collection_id', collectionId)
      .order('sort_order', { ascending: true });
    if (!opts?.includeDeleted) {
      q = q.is('deleted_at', null);
    }
    const { data } = await q;
    return (data ?? [])
      .map((r) => mapTag(r as Row))
      .filter((t) => (opts?.includeDeleted ? true : t.tagStatus !== 'deleted'));
  }

  async listTagsByCatalogProductId(catalogProductId: string): Promise<CollectionProductTag[]> {
    const { data } = await this.admin
      .from('collection_product_tags')
      .select('*')
      .eq('catalog_product_id', catalogProductId)
      .is('deleted_at', null);
    return (data ?? [])
      .map((r) => mapTag(r as Row))
      .filter((t) => t.tagStatus !== 'deleted');
  }

  async updateTag(id: string, patch: UpdateTagPatch): Promise<CollectionProductTag> {
    const row: Row = { updated_at: new Date().toISOString() };
    if (patch.catalogProductId !== undefined) row.catalog_product_id = patch.catalogProductId;
    if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
    let strength = patch.recommendationStrength;
    if (patch.isPrimary === true) strength = 'PRIMARY';
    if (patch.isPrimary === false && (strength === undefined || strength === 'PRIMARY')) {
      strength = 'SECONDARY';
    }
    if (strength !== undefined) {
      row.recommendation_strength = strength;
      row.is_primary = strength === 'PRIMARY';
    } else if (patch.isPrimary !== undefined) {
      row.is_primary = patch.isPrimary;
      row.recommendation_strength = patch.isPrimary ? 'PRIMARY' : 'SECONDARY';
    }
    if (patch.tagSource !== undefined) row.tag_source = patch.tagSource;
    if (patch.selectionSource !== undefined) {
      row.selection_source = patch.selectionSource;
      row.tag_source = toLegacyTagSource(patch.selectionSource);
    }
    if (patch.tagStatus !== undefined) row.tag_status = patch.tagStatus;
    if (patch.visibility !== undefined) row.visibility = patch.visibility;
    if (patch.creatorNote !== undefined) row.creator_note = patch.creatorNote;
    if (patch.creatorAction !== undefined) row.creator_action = patch.creatorAction;
    if (patch.detectionSource !== undefined) row.detection_source = patch.detectionSource;
    if (patch.reason !== undefined) row.reason = patch.reason;
    if (patch.evidenceRefs !== undefined) row.evidence_refs = patch.evidenceRefs;
    if (patch.recommendedBy !== undefined) row.recommended_by = patch.recommendedBy;
    if (patch.confidence !== undefined) row.confidence = patch.confidence;
    if (patch.frameCues !== undefined) row.frame_cues = patch.frameCues;
    if (patch.includeInPublish !== undefined) row.include_in_publish = patch.includeInPublish;
    if (patch.nameSnapshot !== undefined) row.name_snapshot = patch.nameSnapshot;
    if (patch.imageSnapshot !== undefined) row.image_snapshot = patch.imageSnapshot;
    if (patch.brandSnapshot !== undefined) row.brand_snapshot = patch.brandSnapshot;
    if (patch.categorySnapshot !== undefined) row.category_snapshot = patch.categorySnapshot;
    if (patch.snapshotUpdatedAt !== undefined) row.snapshot_updated_at = patch.snapshotUpdatedAt;
    if (patch.resolutionStatus !== undefined) row.resolution_status = patch.resolutionStatus;
    if (patch.externalId !== undefined) row.external_id = patch.externalId;
    if (patch.merchantUrl !== undefined) row.merchant_url = patch.merchantUrl;
    if (patch.acceptedAt !== undefined) row.accepted_at = patch.acceptedAt;
    if (patch.firstPublishedAt !== undefined) row.first_published_at = patch.firstPublishedAt;
    if (patch.rejectedAt !== undefined) row.rejected_at = patch.rejectedAt;
    if (patch.archivedAt !== undefined) row.archived_at = patch.archivedAt;
    if (patch.deletedAt !== undefined) row.deleted_at = patch.deletedAt;
    const { data, error } = await this.admin
      .from('collection_product_tags')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Failed to update tag');
    return mapTag(data as Row);
  }

  async deleteTag(id: string): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.admin
      .from('collection_product_tags')
      .update({
        tag_status: 'deleted',
        deleted_at: now,
        visibility: 'hidden',
        include_in_publish: false,
        updated_at: now,
      })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async replaceProposedTags(
    collectionId: string,
    tags: CreateTagInput[],
  ): Promise<CollectionProductTag[]> {
    const existing = await this.listTags(collectionId);
    const used = new Set<string>();
    const out: CollectionProductTag[] = [];
    for (let i = 0; i < tags.length; i++) {
      const incoming = tags[i]!;
      const match = existing.find((e) => {
        if (used.has(e.id)) return false;
        if (incoming.catalogProductId && e.catalogProductId === incoming.catalogProductId) {
          return true;
        }
        if (
          !incoming.catalogProductId &&
          incoming.externalId &&
          e.externalId === incoming.externalId
        ) {
          return true;
        }
        return false;
      });
      if (match) {
        used.add(match.id);
        const keepStatus =
          match.tagStatus === 'accepted' ||
          match.tagStatus === 'published' ||
          match.tagStatus === 'archived';
        out.push(
          await this.updateTag(match.id, {
            catalogProductId: incoming.catalogProductId ?? match.catalogProductId,
            sortOrder: incoming.sortOrder ?? i,
            recommendationStrength:
              incoming.recommendationStrength ?? match.recommendationStrength,
            isPrimary: incoming.isPrimary ?? match.isPrimary,
            tagSource: incoming.tagSource ?? match.tagSource,
            selectionSource: incoming.selectionSource ?? match.selectionSource,
            tagStatus: keepStatus ? match.tagStatus : (incoming.tagStatus ?? 'proposed'),
            visibility: incoming.visibility ?? match.visibility,
            confidence: incoming.confidence ?? match.confidence,
            includeInPublish: incoming.includeInPublish ?? match.includeInPublish,
            nameSnapshot: incoming.nameSnapshot ?? match.nameSnapshot,
            imageSnapshot: incoming.imageSnapshot ?? match.imageSnapshot,
            brandSnapshot: incoming.brandSnapshot ?? match.brandSnapshot,
            categorySnapshot: incoming.categorySnapshot ?? match.categorySnapshot,
            resolutionStatus: incoming.resolutionStatus ?? match.resolutionStatus,
            externalId: incoming.externalId ?? match.externalId,
            merchantUrl: incoming.merchantUrl ?? match.merchantUrl,
          }),
        );
      } else {
        out.push(
          await this.insertTag({
            ...incoming,
            collectionId,
            sortOrder: incoming.sortOrder ?? i,
          }),
        );
      }
    }
    for (const e of existing) {
      if (!used.has(e.id) && e.tagStatus === 'proposed') {
        await this.deleteTag(e.id);
      }
    }
    return out;
  }

  async applySearchSource(id: string, fields: SearchSourceFields): Promise<void> {
    await this.updateCollection(id, {
      searchTitle: fields.searchTitle,
      searchText: fields.searchText,
      searchKeywords: fields.searchKeywords,
      searchBrands: fields.searchBrands,
      searchCategories: fields.searchCategories,
      searchSourceUpdatedAt: fields.searchSourceUpdatedAt,
    });
  }

  async applyCounters(id: string, counters: Partial<MaterializedCounters>): Promise<void> {
    await this.updateCollection(id, {
      ...(counters.viewsCount !== undefined ? { viewsCount: counters.viewsCount } : {}),
      ...(counters.likesCount !== undefined ? { likesCount: counters.likesCount } : {}),
      ...(counters.savesCount !== undefined ? { savesCount: counters.savesCount } : {}),
      ...(counters.sharesCount !== undefined ? { sharesCount: counters.sharesCount } : {}),
      ...(counters.productClicksCount !== undefined
        ? { productClicksCount: counters.productClicksCount }
        : {}),
      ...(counters.purchasesCount !== undefined
        ? { purchasesCount: counters.purchasesCount }
        : {}),
      countersUpdatedAt: counters.countersUpdatedAt ?? new Date().toISOString(),
    });
  }

  async applyQualitySignals(id: string, signals: Partial<QualitySignals>): Promise<void> {
    await this.updateCollection(id, {
      ...(signals.qualityScore !== undefined ? { qualityScore: signals.qualityScore } : {}),
      ...(signals.commerceScore !== undefined ? { commerceScore: signals.commerceScore } : {}),
      ...(signals.searchScore !== undefined ? { searchScore: signals.searchScore } : {}),
      ...(signals.recommendationScore !== undefined
        ? { recommendationScore: signals.recommendationScore }
        : {}),
      ...(signals.trustScore !== undefined ? { trustScore: signals.trustScore } : {}),
      qualitySignalsUpdatedAt: signals.qualitySignalsUpdatedAt ?? new Date().toISOString(),
    });
  }

  async hideCreatorFromDiscovery(creatorId: string): Promise<void> {
    const { error } = await this.admin
      .from('collections')
      .update({
        feed_eligible: false,
        search_eligible: false,
        recs_eligible: false,
        updated_at: new Date().toISOString(),
      })
      .eq('creator_id', creatorId);
    if (error) throw new Error(error.message);
  }

  async restoreCreatorDiscovery(creatorId: string): Promise<void> {
    const { data, error } = await this.admin
      .from('collections')
      .select('id, status, visibility, moderation_state, deleted_at')
      .eq('creator_id', creatorId);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (row.deleted_at) continue;
      const eligible =
        row.status === 'published' &&
        row.visibility === 'public' &&
        row.moderation_state === 'clear';
      const { error: upErr } = await this.admin
        .from('collections')
        .update({
          feed_eligible: eligible,
          search_eligible: eligible,
          recs_eligible: eligible,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      if (upErr) throw new Error(upErr.message);
    }
  }

  async listPublishedPublicByCreator(
    creatorId: string,
    opts: { limit: number; cursor?: { publishedAt: string; id: string } | null },
  ): Promise<Collection[]> {
    let query = this.admin
      .from('collections')
      .select('*')
      .eq('creator_id', creatorId)
      .eq('status', 'published')
      .eq('visibility', 'public')
      .eq('moderation_state', 'clear')
      .is('deleted_at', null)
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(opts.limit);

    const cursor = opts.cursor;
    if (cursor?.publishedAt && cursor.id) {
      // Keyset: (published_at, id) < (cursor.publishedAt, cursor.id) in DESC order
      query = query.or(
        `published_at.lt.${cursor.publishedAt},and(published_at.eq.${cursor.publishedAt},id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => mapCollection(row as Row));
  }

  async sumPublishedCollectionSaves(creatorId: string): Promise<number> {
    const { data, error } = await this.admin
      .from('collections')
      .select('saves_count')
      .eq('creator_id', creatorId)
      .eq('status', 'published')
      .eq('visibility', 'public')
      .eq('moderation_state', 'clear')
      .is('deleted_at', null);
    if (error) throw new Error(error.message);
    let sum = 0;
    for (const row of data ?? []) {
      sum += Number((row as Row).saves_count) || 0;
    }
    return sum;
  }

  async listPublishedCreatorProductTagRows(
    creatorId: string,
    opts: { limit: number; afterCatalogProductId?: string | null },
  ): Promise<PublishedCreatorProductTagRow[]> {
    // PostgREST sees two paths between these tables:
    // 1) collection_product_tags.collection_id → collections.id (intended)
    // 2) collections.primary_product_tag_id → collection_product_tags.id (inverse)
    // Disambiguate with the owning FK column on the tag row.
    let query = this.admin
      .from('collection_product_tags')
      .select(
        `
        catalog_product_id,
        name_snapshot,
        image_snapshot,
        brand_snapshot,
        resolution_status,
        collection_id,
        collections!collection_id!inner (
          id,
          title,
          creator_id,
          status,
          visibility,
          moderation_state,
          deleted_at
        )
      `,
      )
      .eq('collections.creator_id', creatorId)
      .eq('collections.status', 'published')
      .eq('collections.visibility', 'public')
      .eq('collections.moderation_state', 'clear')
      .is('collections.deleted_at', null)
      .is('deleted_at', null)
      .eq('visibility', 'visible')
      .or('include_in_publish.eq.true,include_in_publish.is.null')
      .not('catalog_product_id', 'is', null)
      .order('catalog_product_id', { ascending: true })
      .limit(opts.limit);

    const after = opts.afterCatalogProductId?.trim();
    if (after) {
      query = query.gt('catalog_product_id', after);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const rows: PublishedCreatorProductTagRow[] = [];
    for (const raw of data ?? []) {
      const row = raw as Row & {
        collections?:
          | { id?: string; title?: string | null }
          | { id?: string; title?: string | null }[]
          | null;
      };
      const catalogProductId =
        typeof row.catalog_product_id === 'string' ? row.catalog_product_id : null;
      if (!catalogProductId) continue;
      const col = Array.isArray(row.collections) ? row.collections[0] : row.collections;
      rows.push({
        catalogProductId,
        nameSnapshot: (row.name_snapshot as string) ?? null,
        imageSnapshot: (row.image_snapshot as string) ?? null,
        brandSnapshot: (row.brand_snapshot as string) ?? null,
        resolutionStatus:
          (row.resolution_status as CollectionProductTag['resolutionStatus']) ?? null,
        collectionId: (col?.id as string) ?? String(row.collection_id),
        collectionTitle: (col?.title as string | null | undefined) ?? null,
      });
    }
    return rows;
  }
}
