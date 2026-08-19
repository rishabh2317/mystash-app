import type {
  CollectionRepository,
  CreateTagInput,
  UpdateTagPatch,
} from './CollectionRepository';
import { assertCollectionOwner, buildCreatorSnapshot, type AuthUserLike } from './auth';
import { buildCollectionEventPayload } from './domain/events';
import { applyEligibilityToCollection } from './domain/eligibility';
import { assertTransition } from './domain/lifecycle';
import { compileFromCollection } from './domain/searchSourceCompile';
import type {
  Collection,
  CollectionAggregate,
  CollectionMedia,
  CollectionOriginType,
  CollectionProductTag,
  CollectionVisibility,
  MaterializedCounters,
  MediaKind,
  PipelineFacetStatus,
  QualitySignals,
  RecommendationIntentSource,
  RecommendationStrength,
  SelectionSource,
  SourceAvailability,
} from './domain/types';
import {
  CREATOR_NOTE_MAX_LENGTH,
  isPrimaryTag,
  isPublishSurfaceTag,
  mapLegacyTagSource,
} from './domain/types';
import { emitCollectionEvent } from './observability';
import { emitMediaEvent } from './mediaEvents';
import { emitProductTagEvent } from './tagEvents';
import { buildProductTagEventPayload } from './domain/tagEvents';
import { assertTagStatusTransition } from './domain/tagLifecycle';
import { assertMediaTransition } from './domain/mediaLifecycle';
import { generateCollectionSlug } from './slug';
import { detectPlatform, extractYouTubeVideoId } from '../pipeline/detect';
import { transformToEmbedUrl } from '../pipeline/embed';
import type { UserCreatorPort } from '../user/ports';
import { UserServiceError } from '../user/UserService';

export class CollectionServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'CollectionServiceError';
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PublishedCollectionListItem = {
  id: string;
  slug: string;
  title: string | null;
  status: Collection['status'];
  visibility: Collection['visibility'];
  publishedAt: string | null;
  heroThumbnailUrl: string | null;
  productTagCount: number;
  creator: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  counters: {
    views: number;
    saves: number;
  };
};

export function toPublishedCollectionListItem(c: Collection): PublishedCollectionListItem {
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    status: c.status,
    visibility: c.visibility,
    publishedAt: c.publishedAt,
    heroThumbnailUrl: c.heroThumbnailUrl,
    productTagCount: c.productTagCount,
    creator: {
      id: c.creatorId,
      username: c.creatorUsername,
      displayName: c.creatorName,
      avatarUrl: c.creatorAvatar,
    },
    counters: {
      views: c.viewsCount,
      saves: c.savesCount,
    },
  };
}

function encodePublishedListCursor(cursor: { publishedAt: string; id: string }): string {
  return Buffer.from(JSON.stringify({ p: cursor.publishedAt, i: cursor.id }), 'utf8').toString(
    'base64url',
  );
}

function decodePublishedListCursor(
  cursor?: string | null,
): { publishedAt: string; id: string } | null {
  if (!cursor?.trim()) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      p?: string;
      i?: string;
    };
    if (typeof parsed.p === 'string' && typeof parsed.i === 'string' && parsed.p && parsed.i) {
      return { publishedAt: parsed.p, id: parsed.i };
    }
  } catch {
    /* invalid cursor → start */
  }
  return null;
}

const allowAllCreators: UserCreatorPort = {
  async assertCanCreateCollections() {},
  async getCreatorSnapshot() {
    return null;
  },
};

export class CollectionService {
  constructor(
    private readonly repo: CollectionRepository,
    private readonly creators: UserCreatorPort = allowAllCreators,
  ) {}

  async getAggregate(id: string): Promise<CollectionAggregate | null> {
    return this.repo.getAggregate(id);
  }

  async getBySlug(slug: string): Promise<CollectionAggregate | null> {
    const c = await this.repo.getCollectionBySlug(slug);
    if (!c) return null;
    return this.repo.getAggregate(c.id);
  }

  canRead(collection: Collection, userId: string | null): boolean {
    if (collection.deletedAt) return false;
    if (userId && collection.creatorId === userId) return true;
    return (
      collection.status === 'published' &&
      collection.visibility === 'public' &&
      collection.moderationState === 'clear'
    );
  }

  /**
   * Public Creator Profile grid. Always published+public+clear only
   * (no owner draft bypass).
   */
  async listPublishedPublicByCreator(
    creatorId: string,
    opts?: { limit?: number; cursor?: string | null },
  ): Promise<{ collections: PublishedCollectionListItem[]; nextCursor: string | null }> {
    const creatorIdTrimmed = creatorId?.trim();
    if (!creatorIdTrimmed || !UUID_RE.test(creatorIdTrimmed)) {
      throw new CollectionServiceError('creator_id must be a valid UUID', 400);
    }
    const limitRaw = opts?.limit ?? 20;
    if (!Number.isFinite(limitRaw) || limitRaw < 1) {
      throw new CollectionServiceError('limit must be between 1 and 50', 400);
    }
    const limit = Math.min(50, Math.max(1, Math.floor(limitRaw)));
    const cursor = decodePublishedListCursor(opts?.cursor);
    const rows = await this.repo.listPublishedPublicByCreator(creatorIdTrimmed, {
      limit: limit + 1,
      cursor,
    });
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last?.publishedAt
        ? encodePublishedListCursor({ publishedAt: last.publishedAt, id: last.id })
        : null;
    return {
      collections: page.map(toPublishedCollectionListItem),
      nextCursor,
    };
  }

  async createDraft(params: {
    user: AuthUserLike;
    title?: string | null;
    caption?: string | null;
    originType: CollectionOriginType;
    originPlatform?: string | null;
    originSourceUrl?: string | null;
    qualityScore?: number | null;
    status?: Collection['status'];
  }): Promise<Collection> {
    try {
      await this.creators.assertCanCreateCollections(params.user.id);
    } catch (e) {
      if (e instanceof UserServiceError) {
        throw new CollectionServiceError(e.message, e.statusCode);
      }
      throw e;
    }
    const fromUser = await this.creators.getCreatorSnapshot(params.user.id);
    const snapshot = fromUser ?? buildCreatorSnapshot(params.user);
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.repo.insertCollection({
          slug: generateCollectionSlug(params.title),
          creatorId: params.user.id,
          status: params.status ?? 'draft',
          title: params.title ?? null,
          caption: params.caption ?? null,
          originType: params.originType,
          originPlatform: params.originPlatform ?? null,
          originSourceUrl: params.originSourceUrl ?? null,
          qualityScore: params.qualityScore ?? null,
          ...snapshot,
        });
      } catch (e) {
        lastErr = e as Error;
        if (!/unique|duplicate/i.test(lastErr.message)) throw lastErr;
      }
    }
    throw lastErr ?? new Error('Could not create collection');
  }

  async attachPrimaryExternalVideo(params: {
    collectionId: string;
    userId: string;
    sourceUrl: string;
    embedUrl?: string | null;
    thumbnailUrl?: string | null;
    title?: string | null;
    externalId?: string | null;
    sourceProvider?: string | null;
    mediaKind?: MediaKind;
    providerCreatorId?: string | null;
    providerCreatorName?: string | null;
  }): Promise<CollectionMedia> {
    return this.attachPrimaryExternalSource(params);
  }

  /** Attach exactly one primary external source reference (always a new row). */
  async attachPrimaryExternalSource(params: {
    collectionId: string;
    userId: string;
    sourceUrl: string;
    embedUrl?: string | null;
    thumbnailUrl?: string | null;
    title?: string | null;
    externalId?: string | null;
    sourceProvider?: string | null;
    mediaKind?: MediaKind;
    providerCreatorId?: string | null;
    providerCreatorName?: string | null;
  }): Promise<CollectionMedia> {
    const collection = await this.requireOwned(params.collectionId, params.userId);
    if (['published', 'unpublished', 'archived', 'deleted'].includes(collection.status)) {
      throw new CollectionServiceError('Cannot replace media after publish lifecycle', 400);
    }

    const existing = await this.repo.listMedia(collection.id);
    const primary = existing.find((m) => m.isPrimary);
    if (primary) {
      throw new CollectionServiceError(
        'Collection already has primary media; V1 supports one external source',
        400,
      );
    }

    const provider =
      params.sourceProvider ??
      (() => {
        const p = detectPlatform(params.sourceUrl);
        return p === 'unknown' ? 'web' : p;
      })();
    const externalId =
      params.externalId ??
      (provider === 'youtube' ? extractYouTubeVideoId(params.sourceUrl) : null);
    const embedUrl =
      params.embedUrl ?? transformToEmbedUrl(params.sourceUrl, provider) ?? params.sourceUrl;

    const media = await this.repo.insertMedia({
      collectionId: collection.id,
      isPrimary: true,
      mediaKind: params.mediaKind ?? 'video',
      sourceProvider: provider,
      externalId,
      canonicalUrl: params.sourceUrl,
      sourceUrl: params.sourceUrl,
      embedUrl,
      title: params.title ?? null,
      providerCreatorId: params.providerCreatorId ?? null,
      providerCreatorName: params.providerCreatorName ?? null,
      thumbnailUrl: params.thumbnailUrl ?? null,
      processingStatus: 'imported',
      sourceAvailability: 'unknown',
    });

    await this.repo.updateCollection(collection.id, {
      primaryMediaId: media.id,
      mediaCount: existing.length + 1,
      heroThumbnailUrl: params.thumbnailUrl ?? collection.heroThumbnailUrl,
    });

    emitMediaEvent('MediaAttached', {
      mediaId: media.id,
      collectionId: collection.id,
      processingStatus: media.processingStatus,
    });

    return media;
  }

  async syncMediaMetadata(params: {
    collectionId: string;
    mediaId?: string;
    title?: string | null;
    thumbnailUrl?: string | null;
    embedUrl?: string | null;
    durationMs?: number | null;
    language?: string | null;
    region?: string | null;
    providerCreatorId?: string | null;
    providerCreatorName?: string | null;
    sourcePublishedAt?: string | null;
    sourceAvailability?: SourceAvailability;
    providerMetadataVersion?: string | null;
  }): Promise<CollectionMedia> {
    const media = await this.requirePrimaryMedia(params.collectionId, params.mediaId);
    const synced = await this.repo.updateMedia(media.id, {
      ...(params.title !== undefined ? { title: params.title } : {}),
      ...(params.thumbnailUrl !== undefined ? { thumbnailUrl: params.thumbnailUrl } : {}),
      ...(params.embedUrl !== undefined ? { embedUrl: params.embedUrl } : {}),
      ...(params.durationMs !== undefined ? { durationMs: params.durationMs } : {}),
      ...(params.language !== undefined ? { language: params.language } : {}),
      ...(params.region !== undefined ? { region: params.region } : {}),
      ...(params.providerCreatorId !== undefined
        ? { providerCreatorId: params.providerCreatorId }
        : {}),
      ...(params.providerCreatorName !== undefined
        ? { providerCreatorName: params.providerCreatorName }
        : {}),
      ...(params.sourcePublishedAt !== undefined
        ? { sourcePublishedAt: params.sourcePublishedAt }
        : {}),
      ...(params.sourceAvailability !== undefined
        ? { sourceAvailability: params.sourceAvailability }
        : {}),
      ...(params.providerMetadataVersion !== undefined
        ? { providerMetadataVersion: params.providerMetadataVersion }
        : {}),
      lastMetadataSyncedAt: new Date().toISOString(),
    });

    if (params.thumbnailUrl) {
      await this.repo.updateCollection(params.collectionId, {
        heroThumbnailUrl: params.thumbnailUrl,
      });
    }
    if (params.title) {
      const c = await this.repo.getCollection(params.collectionId);
      if (c && !c.title) {
        await this.repo.updateCollection(params.collectionId, { title: params.title });
      }
    }

    emitMediaEvent('MetadataSynced', {
      mediaId: synced.id,
      collectionId: synced.collectionId,
      processingStatus: synced.processingStatus,
    });
    return synced;
  }

  async startMediaProcessing(params: {
    collectionId: string;
    mediaId?: string;
    jobId?: string | null;
    artifactBundleRef?: string | null;
  }): Promise<CollectionMedia> {
    const media = await this.requirePrimaryMedia(params.collectionId, params.mediaId);
    if (media.processingStatus === 'processing') {
      return this.repo.updateMedia(media.id, {
        latestProcessingJobId: params.jobId ?? media.latestProcessingJobId,
        latestArtifactBundleRef: params.artifactBundleRef ?? media.latestArtifactBundleRef,
      });
    }
    assertMediaTransition(media.processingStatus, 'processing');
    const updated = await this.repo.updateMedia(media.id, {
      processingStatus: 'processing',
      processingAttemptCount: media.processingAttemptCount + 1,
      latestProcessingJobId: params.jobId ?? media.latestProcessingJobId,
      latestArtifactBundleRef: params.artifactBundleRef ?? media.latestArtifactBundleRef,
      lastProcessingErrorCode: null,
      transcriptStatus: 'running' as PipelineFacetStatus,
      mediaUnderstandingStatus: 'running' as PipelineFacetStatus,
    });
    emitMediaEvent('MediaProcessingStarted', {
      mediaId: updated.id,
      collectionId: updated.collectionId,
      processingStatus: updated.processingStatus,
      jobId: params.jobId,
    });
    return updated;
  }

  async completeMediaProcessing(params: {
    collectionId: string;
    mediaId?: string;
    jobId?: string | null;
    artifactBundleRef?: string | null;
    durationMs?: number | null;
    transcriptStatus?: PipelineFacetStatus;
    mediaUnderstandingStatus?: PipelineFacetStatus;
  }): Promise<CollectionMedia> {
    const media = await this.requirePrimaryMedia(params.collectionId, params.mediaId);
    if (media.processingStatus === 'ready') {
      return this.repo.updateMedia(media.id, {
        latestProcessingJobId: params.jobId ?? media.latestProcessingJobId,
        latestArtifactBundleRef: params.artifactBundleRef ?? media.latestArtifactBundleRef,
        ...(params.durationMs !== undefined ? { durationMs: params.durationMs } : {}),
      });
    }
    assertMediaTransition(media.processingStatus, 'ready');
    const updated = await this.repo.updateMedia(media.id, {
      processingStatus: 'ready',
      latestProcessingJobId: params.jobId ?? media.latestProcessingJobId,
      latestArtifactBundleRef: params.artifactBundleRef ?? media.latestArtifactBundleRef,
      lastProcessedAt: new Date().toISOString(),
      lastProcessingErrorCode: null,
      ...(params.durationMs !== undefined ? { durationMs: params.durationMs } : {}),
      transcriptStatus: params.transcriptStatus ?? 'succeeded',
      mediaUnderstandingStatus: params.mediaUnderstandingStatus ?? 'succeeded',
    });
    emitMediaEvent('MediaProcessingCompleted', {
      mediaId: updated.id,
      collectionId: updated.collectionId,
      processingStatus: updated.processingStatus,
      jobId: params.jobId,
    });
    return updated;
  }

  async failMediaProcessing(params: {
    collectionId: string;
    mediaId?: string;
    jobId?: string | null;
    artifactBundleRef?: string | null;
    errorCode: string;
    transcriptStatus?: PipelineFacetStatus;
    mediaUnderstandingStatus?: PipelineFacetStatus;
  }): Promise<CollectionMedia> {
    const media = await this.requirePrimaryMedia(params.collectionId, params.mediaId);
    assertMediaTransition(media.processingStatus, 'failed');
    const updated = await this.repo.updateMedia(media.id, {
      processingStatus: 'failed',
      latestProcessingJobId: params.jobId ?? media.latestProcessingJobId,
      latestArtifactBundleRef: params.artifactBundleRef ?? media.latestArtifactBundleRef,
      lastProcessedAt: new Date().toISOString(),
      lastProcessingErrorCode: params.errorCode,
      transcriptStatus: params.transcriptStatus ?? 'failed',
      mediaUnderstandingStatus: params.mediaUnderstandingStatus ?? 'failed',
    });
    emitMediaEvent('MediaProcessingFailed', {
      mediaId: updated.id,
      collectionId: updated.collectionId,
      processingStatus: updated.processingStatus,
      jobId: params.jobId,
      errorCode: params.errorCode,
    });
    return updated;
  }

  async markSourceUnavailable(params: {
    collectionId: string;
    mediaId?: string;
    availability?: Extract<SourceAvailability, 'unavailable' | 'restricted'>;
  }): Promise<CollectionMedia> {
    const media = await this.requirePrimaryMedia(params.collectionId, params.mediaId);
    const availability = params.availability ?? 'unavailable';
    const updated = await this.repo.updateMedia(media.id, {
      sourceAvailability: availability,
    });
    emitMediaEvent('SourceUnavailable', {
      mediaId: updated.id,
      collectionId: updated.collectionId,
      processingStatus: updated.processingStatus,
      errorCode: availability,
    });
    return updated;
  }

  async archiveMedia(params: {
    collectionId: string;
    mediaId?: string;
  }): Promise<CollectionMedia> {
    const media = await this.requirePrimaryMedia(params.collectionId, params.mediaId);
    assertMediaTransition(media.processingStatus, 'archived');
    return this.repo.updateMedia(media.id, { processingStatus: 'archived' });
  }

  private async requirePrimaryMedia(
    collectionId: string,
    mediaId?: string,
  ): Promise<CollectionMedia> {
    const list = await this.repo.listMedia(collectionId);
    const media = mediaId
      ? list.find((m) => m.id === mediaId)
      : list.find((m) => m.isPrimary) ?? list[0];
    if (!media) throw new CollectionServiceError('Media not found', 404);
    return media;
  }

  async startProcessing(params: {
    collectionId: string;
    userId: string;
    ingestRunId?: string | null;
  }): Promise<Collection> {
    const collection = await this.requireOwned(params.collectionId, params.userId);
    assertTransition(collection.status, 'processing');
    const updated = await this.repo.updateCollection(collection.id, {
      status: 'processing',
      latestIngestRunId: params.ingestRunId ?? collection.latestIngestRunId,
    });
    emitCollectionEvent(
      'CollectionProcessingStarted',
      buildCollectionEventPayload({
        collectionId: updated.id,
        creatorId: updated.creatorId,
        status: updated.status,
        contentRevision: updated.contentRevision,
        ingestId: params.ingestRunId,
        slug: updated.slug,
      }),
    );
    return updated;
  }

  /** Apply ingest/pipeline terminal result: status + proposed tags. */
  async applyIngestResult(params: {
    collectionId: string;
    status: 'ready_for_review' | 'review_required';
    title?: string | null;
    thumbnailUrl?: string | null;
    proposedTags: CreateTagInput[];
    recommendationIntent?: string | null;
    recommendationIntentConfidence?: number | null;
    ingestRunId?: string | null;
  }): Promise<Collection> {
    const collection = await this.repo.getCollection(params.collectionId);
    if (!collection) throw new CollectionServiceError('Collection not found', 404);
    if (collection.status === 'deleted') {
      throw new CollectionServiceError('Collection deleted', 400);
    }

    const priorIds = new Set(
      (await this.repo.listTags(collection.id)).map((t) => t.id),
    );
    const tags = await this.repo.replaceProposedTags(
      collection.id,
      params.proposedTags.map((t, i) => {
        const selection =
          t.selectionSource ??
          (t.tagSource ? mapLegacyTagSource(t.tagSource) : 'AI_DETECTED');
        const strength: RecommendationStrength =
          t.recommendationStrength ?? (i === 0 || t.isPrimary ? 'PRIMARY' : 'SECONDARY');
        return {
          ...t,
          collectionId: collection.id,
          sortOrder: t.sortOrder ?? i,
          recommendationStrength: strength,
          isPrimary: strength === 'PRIMARY',
          selectionSource: selection,
          tagSource: t.tagSource ?? (selection === 'CREATOR_MANUAL' ? 'manual' : 'ai'),
          tagStatus: t.tagStatus ?? 'proposed',
          visibility: t.visibility ?? 'visible',
          includeInPublish: t.includeInPublish ?? true,
        };
      }),
    );
    for (const tag of tags) {
      if (priorIds.has(tag.id)) continue;
      emitProductTagEvent(
        'ProductTagProposed',
        buildProductTagEventPayload({
          collectionProductTagId: tag.id,
          collectionId: collection.id,
          catalogProductId: tag.catalogProductId,
          tagStatus: tag.tagStatus,
          selectionSource: tag.selectionSource,
          recommendationStrength: tag.recommendationStrength,
        }),
      );
    }

    const primary = tags.find((t) => isPrimaryTag(t)) ?? tags[0] ?? null;
    const search = compileFromCollection(
      {
        title: params.title ?? collection.title,
        caption: collection.caption,
        recommendationIntent:
          params.recommendationIntent ?? collection.recommendationIntent,
        recommendationIntentsSecondary: collection.recommendationIntentsSecondary,
      },
      tags,
    );

    const eligibility = applyEligibilityToCollection({
      ...collection,
      status: params.status,
    });

    return this.repo.updateCollection(collection.id, {
      status: params.status,
      title: params.title ?? collection.title,
      heroThumbnailUrl: params.thumbnailUrl ?? collection.heroThumbnailUrl,
      productTagCount: tags.filter(isPublishSurfaceTag).length,
      primaryProductTagId: primary?.id ?? null,
      primaryProductNameSnapshot: primary?.nameSnapshot ?? null,
      recommendationIntent:
        params.recommendationIntent ?? collection.recommendationIntent,
      recommendationIntentSource: params.recommendationIntent
        ? 'ai'
        : collection.recommendationIntentSource,
      recommendationIntentConfidence:
        params.recommendationIntentConfidence ?? collection.recommendationIntentConfidence,
      latestIngestRunId: params.ingestRunId ?? collection.latestIngestRunId,
      ...search,
      ...eligibility,
    });
  }

  async updateContent(params: {
    collectionId: string;
    userId: string;
    title?: string | null;
    caption?: string | null;
    language?: string | null;
    primaryLocale?: string | null;
    recommendationIntent?: string | null;
    recommendationIntentsSecondary?: string[];
    visibility?: CollectionVisibility;
  }): Promise<Collection> {
    const collection = await this.requireOwned(params.collectionId, params.userId);
    if (collection.status === 'deleted') {
      throw new CollectionServiceError('Collection deleted', 400);
    }

    const nextIntent =
      params.recommendationIntent !== undefined
        ? params.recommendationIntent
        : collection.recommendationIntent;
    const nextSecondary =
      params.recommendationIntentsSecondary ?? collection.recommendationIntentsSecondary;
    const intentSource: RecommendationIntentSource | null =
      params.recommendationIntent !== undefined
        ? 'creator'
        : collection.recommendationIntentSource;

    const tags = await this.repo.listTags(collection.id);
    const search = compileFromCollection(
      {
        title: params.title !== undefined ? params.title : collection.title,
        caption: params.caption !== undefined ? params.caption : collection.caption,
        recommendationIntent: nextIntent,
        recommendationIntentsSecondary: nextSecondary,
      },
      tags,
    );

    const visibility = params.visibility ?? collection.visibility;
    const eligibility = applyEligibilityToCollection({
      ...collection,
      visibility,
    });

    const bumpRevision = collection.status === 'published';
    const updated = await this.repo.updateCollection(collection.id, {
      title: params.title !== undefined ? params.title : collection.title,
      caption: params.caption !== undefined ? params.caption : collection.caption,
      language: params.language !== undefined ? params.language : collection.language,
      primaryLocale:
        params.primaryLocale !== undefined ? params.primaryLocale : collection.primaryLocale,
      recommendationIntent: nextIntent,
      recommendationIntentsSecondary: nextSecondary,
      recommendationIntentSource: intentSource,
      recommendationIntentConfidence:
        params.recommendationIntent !== undefined
          ? null
          : collection.recommendationIntentConfidence,
      visibility,
      contentRevision: bumpRevision
        ? collection.contentRevision + 1
        : collection.contentRevision,
      ...search,
      ...eligibility,
    });

    if (bumpRevision) {
      emitCollectionEvent(
        'CollectionUpdated',
        buildCollectionEventPayload({
          collectionId: updated.id,
          creatorId: updated.creatorId,
          status: updated.status,
          contentRevision: updated.contentRevision,
          slug: updated.slug,
        }),
      );
    }
    return updated;
  }

  async addTag(params: {
    collectionId: string;
    userId: string;
    tag: Omit<CreateTagInput, 'collectionId'>;
  }): Promise<CollectionProductTag> {
    const collection = await this.requireOwned(params.collectionId, params.userId);
    const existing = await this.repo.listTags(collection.id);
    if (params.tag.catalogProductId) {
      const dup = existing.find(
        (t) => t.catalogProductId === params.tag.catalogProductId && !t.deletedAt,
      );
      if (dup) throw new CollectionServiceError('Product already tagged on this Collection', 409);
    }
    if (params.tag.creatorNote && params.tag.creatorNote.length > CREATOR_NOTE_MAX_LENGTH) {
      throw new CollectionServiceError(
        `creator_note must be at most ${CREATOR_NOTE_MAX_LENGTH} characters`,
        400,
      );
    }
    const selection: SelectionSource =
      params.tag.selectionSource ??
      (params.tag.tagSource ? mapLegacyTagSource(params.tag.tagSource) : 'CREATOR_MANUAL');
    const strength: RecommendationStrength =
      params.tag.recommendationStrength ??
      (params.tag.isPrimary || existing.filter(isPublishSurfaceTag).length === 0
        ? 'PRIMARY'
        : 'SECONDARY');
    if (strength === 'PRIMARY') {
      for (const t of existing.filter((x) => isPrimaryTag(x))) {
        await this.repo.updateTag(t.id, {
          recommendationStrength: 'SECONDARY',
          isPrimary: false,
        });
      }
    }
    const now = new Date().toISOString();
    const tag = await this.repo.insertTag({
      ...params.tag,
      collectionId: collection.id,
      sortOrder: params.tag.sortOrder ?? existing.length,
      recommendationStrength: strength,
      isPrimary: strength === 'PRIMARY',
      selectionSource: selection,
      tagSource: params.tag.tagSource ?? (selection === 'CREATOR_MANUAL' ? 'manual' : 'ai'),
      tagStatus: 'accepted',
      creatorAction: 'added_manual',
      acceptedAt: now,
      snapshotUpdatedAt: now,
      visibility: params.tag.visibility ?? 'visible',
      includeInPublish: params.tag.includeInPublish ?? true,
    });
    emitProductTagEvent(
      'ProductTagAddedManual',
      buildProductTagEventPayload({
        collectionProductTagId: tag.id,
        collectionId: collection.id,
        catalogProductId: tag.catalogProductId,
        tagStatus: tag.tagStatus,
        selectionSource: tag.selectionSource,
        recommendationStrength: tag.recommendationStrength,
      }),
    );
    await this.refreshTagSummariesAndSearch(collection.id);
    return tag;
  }

  async acceptTag(params: {
    collectionId: string;
    userId: string;
    tagId: string;
  }): Promise<CollectionProductTag> {
    await this.requireOwned(params.collectionId, params.userId);
    const tags = await this.repo.listTags(params.collectionId, { includeDeleted: true });
    const found = tags.find((t) => t.id === params.tagId);
    if (!found) throw new CollectionServiceError('Tag not found', 404);
    try {
      assertTagStatusTransition(found.tagStatus, 'accepted');
    } catch (e) {
      throw new CollectionServiceError((e as Error).message, 400);
    }
    const now = new Date().toISOString();
    const selection: SelectionSource =
      found.selectionSource === 'AI_DETECTED' || found.selectionSource === 'AI_RECOMMENDED'
        ? 'CREATOR_ACCEPTED_AI'
        : found.selectionSource;
    const updated = await this.repo.updateTag(params.tagId, {
      tagStatus: 'accepted',
      selectionSource: selection,
      creatorAction: 'accepted',
      acceptedAt: found.acceptedAt ?? now,
      snapshotUpdatedAt: now,
      rejectedAt: null,
    });
    emitProductTagEvent(
      'ProductTagAccepted',
      buildProductTagEventPayload({
        collectionProductTagId: updated.id,
        collectionId: params.collectionId,
        catalogProductId: updated.catalogProductId,
        tagStatus: updated.tagStatus,
        selectionSource: updated.selectionSource,
        from: found.tagStatus,
        to: 'accepted',
      }),
    );
    await this.refreshTagSummariesAndSearch(params.collectionId);
    return updated;
  }

  async rejectTag(params: {
    collectionId: string;
    userId: string;
    tagId: string;
    reason?: string | null;
  }): Promise<CollectionProductTag> {
    await this.requireOwned(params.collectionId, params.userId);
    const tags = await this.repo.listTags(params.collectionId, { includeDeleted: true });
    const found = tags.find((t) => t.id === params.tagId);
    if (!found) throw new CollectionServiceError('Tag not found', 404);
    try {
      assertTagStatusTransition(found.tagStatus, 'rejected');
    } catch (e) {
      throw new CollectionServiceError((e as Error).message, 400);
    }
    const now = new Date().toISOString();
    const updated = await this.repo.updateTag(params.tagId, {
      tagStatus: 'rejected',
      creatorAction: 'rejected',
      reason: params.reason ?? found.reason,
      rejectedAt: now,
      includeInPublish: false,
      visibility: 'hidden',
    });
    emitProductTagEvent(
      'ProductTagRejected',
      buildProductTagEventPayload({
        collectionProductTagId: updated.id,
        collectionId: params.collectionId,
        catalogProductId: updated.catalogProductId,
        tagStatus: updated.tagStatus,
        from: found.tagStatus,
        to: 'rejected',
      }),
    );
    await this.refreshTagSummariesAndSearch(params.collectionId);
    return updated;
  }

  async updateTag(params: {
    collectionId: string;
    userId: string;
    tagId: string;
    patch: UpdateTagPatch;
  }): Promise<CollectionProductTag> {
    await this.requireOwned(params.collectionId, params.userId);
    const tags = await this.repo.listTags(params.collectionId);
    const found = tags.find((t) => t.id === params.tagId);
    if (!found) throw new CollectionServiceError('Tag not found', 404);

    if (params.patch.creatorNote != null && params.patch.creatorNote.length > CREATOR_NOTE_MAX_LENGTH) {
      throw new CollectionServiceError(
        `creator_note must be at most ${CREATOR_NOTE_MAX_LENGTH} characters`,
        400,
      );
    }

    let strength = params.patch.recommendationStrength;
    if (params.patch.isPrimary === true) strength = 'PRIMARY';
    if (params.patch.isPrimary === false && (strength === undefined || strength === 'PRIMARY')) {
      strength = 'SECONDARY';
    }
    if (strength === 'PRIMARY') {
      for (const t of tags.filter((x) => isPrimaryTag(x) && x.id !== params.tagId)) {
        await this.repo.updateTag(t.id, {
          recommendationStrength: 'SECONDARY',
          isPrimary: false,
        });
      }
    }

    const snapshotTouched =
      params.patch.nameSnapshot !== undefined ||
      params.patch.imageSnapshot !== undefined ||
      params.patch.brandSnapshot !== undefined ||
      params.patch.categorySnapshot !== undefined;

    const updated = await this.repo.updateTag(params.tagId, {
      ...params.patch,
      ...(strength !== undefined
        ? { recommendationStrength: strength, isPrimary: strength === 'PRIMARY' }
        : {}),
      ...(params.patch.creatorNote !== undefined
        ? { creatorAction: 'note_edited' as const }
        : {}),
      ...(snapshotTouched ? { snapshotUpdatedAt: new Date().toISOString() } : {}),
    });

    if (params.patch.creatorNote !== undefined) {
      emitProductTagEvent(
        'ProductTagNoteUpdated',
        buildProductTagEventPayload({
          collectionProductTagId: updated.id,
          collectionId: params.collectionId,
          catalogProductId: updated.catalogProductId,
        }),
      );
    }
    if (strength !== undefined && strength !== found.recommendationStrength) {
      emitProductTagEvent(
        'ProductTagStrengthChanged',
        buildProductTagEventPayload({
          collectionProductTagId: updated.id,
          collectionId: params.collectionId,
          catalogProductId: updated.catalogProductId,
          recommendationStrength: strength,
          from: found.recommendationStrength,
          to: strength,
        }),
      );
    }

    await this.refreshTagSummariesAndSearch(params.collectionId);
    return updated;
  }

  async removeTag(params: {
    collectionId: string;
    userId: string;
    tagId: string;
  }): Promise<void> {
    await this.requireOwned(params.collectionId, params.userId);
    const tags = await this.repo.listTags(params.collectionId);
    const found = tags.find((t) => t.id === params.tagId);
    if (!found) throw new CollectionServiceError('Tag not found', 404);
    await this.repo.deleteTag(params.tagId);
    emitProductTagEvent(
      'ProductTagRemoved',
      buildProductTagEventPayload({
        collectionProductTagId: found.id,
        collectionId: params.collectionId,
        catalogProductId: found.catalogProductId,
        tagStatus: 'deleted',
        from: found.tagStatus,
        to: 'deleted',
      }),
    );
    await this.refreshTagSummariesAndSearch(params.collectionId);
  }

  /**
   * Catalog merge contract: remap Tag FKs from source → target Catalog id.
   * Collision: keep stronger / earlier accepted Tag; soft-delete the other.
   */
  async remapCatalogProductAfterMerge(params: {
    sourceId: string;
    targetId: string;
  }): Promise<{ remapped: number; collisionsResolved: number }> {
    const sourceTags = await this.repo.listTagsByCatalogProductId(params.sourceId);
    let remapped = 0;
    let collisionsResolved = 0;
    const touchedCollections = new Set<string>();

    for (const tag of sourceTags) {
      const siblings = await this.repo.listTags(tag.collectionId);
      const targetSibling = siblings.find(
        (t) =>
          t.id !== tag.id &&
          t.catalogProductId === params.targetId &&
          !t.deletedAt &&
          t.tagStatus !== 'deleted',
      );

      if (targetSibling) {
        const keepSource =
          (tag.recommendationStrength === 'PRIMARY' &&
            targetSibling.recommendationStrength !== 'PRIMARY') ||
          (tag.recommendationStrength === targetSibling.recommendationStrength &&
            (tag.acceptedAt ?? tag.createdAt) < (targetSibling.acceptedAt ?? targetSibling.createdAt));

        if (keepSource) {
          await this.repo.deleteTag(targetSibling.id);
          await this.repo.updateTag(tag.id, { catalogProductId: params.targetId });
          emitProductTagEvent(
            'ProductTagRematched',
            buildProductTagEventPayload({
              collectionProductTagId: tag.id,
              collectionId: tag.collectionId,
              catalogProductId: params.targetId,
              from: params.sourceId,
              to: params.targetId,
            }),
          );
        } else {
          await this.repo.deleteTag(tag.id);
        }
        collisionsResolved += 1;
        remapped += 1;
      } else {
        await this.repo.updateTag(tag.id, { catalogProductId: params.targetId });
        emitProductTagEvent(
          'ProductTagRematched',
          buildProductTagEventPayload({
            collectionProductTagId: tag.id,
            collectionId: tag.collectionId,
            catalogProductId: params.targetId,
            from: params.sourceId,
            to: params.targetId,
          }),
        );
        remapped += 1;
      }
      touchedCollections.add(tag.collectionId);
    }

    for (const collectionId of touchedCollections) {
      await this.refreshTagSummariesAndSearch(collectionId);
    }

    return { remapped, collisionsResolved };
  }

  /**
   * Mark which tags are included for publish (by external_id), then publish.
   * Intent not required. Requires ≥1 included tag.
   */
  async publish(params: {
    collectionId: string;
    userId: string;
    user?: AuthUserLike;
    visibility?: CollectionVisibility;
    includeExternalIds?: string[] | null;
  }): Promise<Collection> {
    try {
      await this.creators.assertCanCreateCollections(params.userId);
    } catch (e) {
      if (e instanceof UserServiceError) {
        throw new CollectionServiceError(e.message, e.statusCode);
      }
      throw e;
    }
    const collection = await this.requireOwned(params.collectionId, params.userId);
    if (collection.moderationState === 'takedown' || collection.moderationState === 'rejected') {
      throw new CollectionServiceError('Collection cannot be published under moderation hold', 400);
    }

    let tags = await this.repo.listTags(collection.id);
    if (params.includeExternalIds && params.includeExternalIds.length > 0) {
      const selected = new Set(params.includeExternalIds);
      for (const t of tags) {
        const include = !!(t.externalId && selected.has(t.externalId));
        if (t.includeInPublish !== include) {
          await this.repo.updateTag(t.id, { includeInPublish: include });
        }
      }
      tags = await this.repo.listTags(collection.id);
    }

    const included = tags.filter(isPublishSurfaceTag);
    if (included.length < 1) {
      throw new CollectionServiceError('Select at least one product to publish', 400);
    }
    const unresolved = included.filter(
      (t) =>
        !t.catalogProductId ||
        (t.resolutionStatus !== 'VERIFIED' && t.resolutionStatus !== 'UNVERIFIED'),
    );
    if (unresolved.length > 0) {
      throw new CollectionServiceError(
        'All products included in publish must be resolved to a Catalog product',
        400,
      );
    }

    if (collection.status !== 'published') {
      assertTransition(collection.status, 'published');
    }

    const fromUser = await this.creators.getCreatorSnapshot(params.userId);
    const snapshot =
      fromUser ?? (params.user ? buildCreatorSnapshot(params.user) : null);
    if (snapshot) {
      await this.repo.updateCollection(collection.id, snapshot);
    }

    const fresh = await this.repo.getCollection(collection.id);
    if (!fresh) throw new CollectionServiceError('Collection not found', 404);

    const now = new Date().toISOString();
    for (const t of included) {
      await this.repo.updateTag(t.id, {
        tagStatus: 'published',
        firstPublishedAt: t.firstPublishedAt ?? now,
        snapshotUpdatedAt: now,
      });
      emitProductTagEvent(
        'ProductTagPublished',
        buildProductTagEventPayload({
          collectionProductTagId: t.id,
          collectionId: fresh.id,
          catalogProductId: t.catalogProductId,
          tagStatus: 'published',
        }),
      );
    }
    tags = await this.repo.listTags(collection.id);
    const publishedIncluded = tags.filter(isPublishSurfaceTag);

    const search = compileFromCollection(fresh, tags);
    const visibility = params.visibility ?? 'public';
    const primary =
      publishedIncluded.find((t) => isPrimaryTag(t)) ?? publishedIncluded[0]!;
    const eligibility = applyEligibilityToCollection({
      ...fresh,
      status: 'published',
      visibility,
      moderationState: 'clear',
      deletedAt: null,
    });

    const updated = await this.repo.updateCollection(fresh.id, {
      status: 'published',
      visibility,
      publishedAt: fresh.publishedAt ?? now,
      unpublishedAt: null,
      deletedAt: null,
      primaryProductTagId: primary.id,
      primaryProductNameSnapshot: primary.nameSnapshot,
      productTagCount: publishedIncluded.length,
      contentRevision: fresh.contentRevision + 1,
      ...search,
      ...eligibility,
    });

    emitCollectionEvent(
      'CollectionPublished',
      buildCollectionEventPayload({
        collectionId: updated.id,
        creatorId: updated.creatorId,
        status: updated.status,
        contentRevision: updated.contentRevision,
        slug: updated.slug,
      }),
    );
    return updated;
  }

  async reject(params: { collectionId: string; userId: string }): Promise<Collection> {
    const collection = await this.requireOwned(params.collectionId, params.userId);
    assertTransition(collection.status, 'rejected');
    const eligibility = applyEligibilityToCollection({
      ...collection,
      status: 'rejected',
    });
    const updated = await this.repo.updateCollection(collection.id, {
      status: 'rejected',
      ...eligibility,
    });
    emitCollectionEvent(
      'CollectionRejected',
      buildCollectionEventPayload({
        collectionId: updated.id,
        creatorId: updated.creatorId,
        status: updated.status,
        contentRevision: updated.contentRevision,
        slug: updated.slug,
      }),
    );
    return updated;
  }

  async unpublish(params: { collectionId: string; userId: string }): Promise<Collection> {
    const collection = await this.requireOwned(params.collectionId, params.userId);
    assertTransition(collection.status, 'unpublished');
    const now = new Date().toISOString();
    const eligibility = applyEligibilityToCollection({
      ...collection,
      status: 'unpublished',
    });
    const updated = await this.repo.updateCollection(collection.id, {
      status: 'unpublished',
      unpublishedAt: now,
      ...eligibility,
    });
    emitCollectionEvent(
      'CollectionUnpublished',
      buildCollectionEventPayload({
        collectionId: updated.id,
        creatorId: updated.creatorId,
        status: updated.status,
        contentRevision: updated.contentRevision,
        slug: updated.slug,
      }),
    );
    return updated;
  }

  async republish(params: {
    collectionId: string;
    userId: string;
    visibility?: CollectionVisibility;
  }): Promise<Collection> {
    const collection = await this.requireOwned(params.collectionId, params.userId);
    assertTransition(collection.status, 'published');
    return this.publish({
      collectionId: collection.id,
      userId: params.userId,
      visibility: params.visibility ?? collection.visibility,
    });
  }

  async archive(params: { collectionId: string; userId: string }): Promise<Collection> {
    const collection = await this.requireOwned(params.collectionId, params.userId);
    assertTransition(collection.status, 'archived');
    const now = new Date().toISOString();
    const eligibility = applyEligibilityToCollection({
      ...collection,
      status: 'archived',
    });
    const updated = await this.repo.updateCollection(collection.id, {
      status: 'archived',
      archivedAt: now,
      ...eligibility,
    });
    emitCollectionEvent(
      'CollectionArchived',
      buildCollectionEventPayload({
        collectionId: updated.id,
        creatorId: updated.creatorId,
        status: updated.status,
        contentRevision: updated.contentRevision,
        slug: updated.slug,
      }),
    );
    return updated;
  }

  async restore(params: { collectionId: string; userId: string }): Promise<Collection> {
    const collection = await this.requireOwned(params.collectionId, params.userId);
    assertTransition(collection.status, 'unpublished');
    const eligibility = applyEligibilityToCollection({
      ...collection,
      status: 'unpublished',
    });
    return this.repo.updateCollection(collection.id, {
      status: 'unpublished',
      archivedAt: null,
      ...eligibility,
    });
  }

  async softDelete(params: { collectionId: string; userId: string }): Promise<Collection> {
    const collection = await this.requireOwned(params.collectionId, params.userId);
    assertTransition(collection.status, 'deleted');
    const now = new Date().toISOString();
    const eligibility = applyEligibilityToCollection({
      ...collection,
      status: 'deleted',
      deletedAt: now,
    });
    const updated = await this.repo.updateCollection(collection.id, {
      status: 'deleted',
      deletedAt: now,
      ...eligibility,
    });
    emitCollectionEvent(
      'CollectionDeleted',
      buildCollectionEventPayload({
        collectionId: updated.id,
        creatorId: updated.creatorId,
        status: updated.status,
        contentRevision: updated.contentRevision,
        slug: updated.slug,
      }),
    );
    return updated;
  }

  async refreshCreatorSnapshot(params: {
    collectionId: string;
    user: AuthUserLike;
  }): Promise<Collection> {
    const fromUser = await this.creators.getCreatorSnapshot(params.user.id);
    const snapshot = fromUser ?? buildCreatorSnapshot(params.user);
    return this.repo.updateCollection(params.collectionId, snapshot);
  }

  /** Analytics contract — no public API. */
  async updateMaterializedCounters(
    collectionId: string,
    counters: Partial<MaterializedCounters>,
  ): Promise<void> {
    await this.repo.applyCounters(collectionId, counters);
  }

  /** Analytics/Ingest contract — no public API. */
  async updateQualitySignals(
    collectionId: string,
    signals: Partial<QualitySignals>,
  ): Promise<void> {
    await this.repo.applyQualitySignals(collectionId, signals);
    const c = await this.repo.getCollection(collectionId);
    if (!c) return;
    const eligibility = applyEligibilityToCollection(c);
    await this.repo.updateCollection(collectionId, eligibility);
  }

  private async requireOwned(collectionId: string, userId: string): Promise<Collection> {
    const collection = await this.repo.getCollection(collectionId);
    if (!collection || collection.deletedAt) {
      throw new CollectionServiceError('Collection not found', 404);
    }
    try {
      assertCollectionOwner(collection.creatorId, userId);
    } catch {
      throw new CollectionServiceError('Collection not found', 404);
    }
    return collection;
  }

  private async refreshTagSummariesAndSearch(collectionId: string): Promise<void> {
    const collection = await this.repo.getCollection(collectionId);
    if (!collection) return;
    const tags = await this.repo.listTags(collectionId);
    const surface = tags.filter(isPublishSurfaceTag);
    const primary = surface.find((t) => isPrimaryTag(t)) ?? surface[0] ?? null;
    const search = compileFromCollection(collection, tags);
    await this.repo.updateCollection(collectionId, {
      productTagCount: surface.length,
      primaryProductTagId: primary?.id ?? null,
      primaryProductNameSnapshot: primary?.nameSnapshot ?? null,
      ...search,
    });
  }
}
