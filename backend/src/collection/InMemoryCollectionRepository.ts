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
} from './domain/types';
import {
  COLLECTION_SCHEMA_VERSION,
  mapLegacyTagSource,
  toLegacyTagSource,
} from './domain/types';
import { randomUUID } from 'node:crypto';

function now(): string {
  return new Date().toISOString();
}

export class InMemoryCollectionRepository implements CollectionRepository {
  collections = new Map<string, Collection>();
  media = new Map<string, CollectionMedia>();
  tags = new Map<string, CollectionProductTag>();

  async insertCollection(input: CreateCollectionInput): Promise<Collection> {
    for (const c of this.collections.values()) {
      if (c.slug === input.slug) throw new Error('duplicate slug');
    }
    const id = input.id ?? randomUUID();
    const ts = now();
    const collection: Collection = {
      id,
      slug: input.slug,
      creatorId: input.creatorId,
      createdAt: ts,
      updatedAt: ts,
      status: input.status ?? 'draft',
      visibility: input.visibility ?? 'private',
      publishedAt: null,
      unpublishedAt: null,
      archivedAt: null,
      deletedAt: null,
      contentRevision: 0,
      title: input.title ?? null,
      caption: input.caption ?? null,
      language: null,
      primaryLocale: null,
      recommendationIntent: null,
      recommendationIntentsSecondary: [],
      recommendationIntentSource: null,
      recommendationIntentConfidence: null,
      creatorName: input.creatorName ?? null,
      creatorUsername: input.creatorUsername ?? null,
      creatorAvatar: input.creatorAvatar ?? null,
      creatorVerified: input.creatorVerified ?? false,
      creatorSnapshotUpdatedAt: input.creatorSnapshotUpdatedAt ?? ts,
      primaryMediaId: null,
      mediaCount: 0,
      heroThumbnailUrl: null,
      primaryProductTagId: null,
      productTagCount: 0,
      primaryProductNameSnapshot: null,
      searchTitle: null,
      searchText: null,
      searchKeywords: [],
      searchBrands: [],
      searchCategories: [],
      searchSourceUpdatedAt: null,
      viewsCount: 0,
      likesCount: 0,
      savesCount: 0,
      sharesCount: 0,
      productClicksCount: 0,
      purchasesCount: 0,
      countersUpdatedAt: null,
      qualityScore: input.qualityScore ?? null,
      commerceScore: null,
      searchScore: null,
      recommendationScore: null,
      trustScore: null,
      qualitySignalsUpdatedAt: null,
      feedEligible: false,
      searchEligible: false,
      recsEligible: false,
      moderationState: 'clear',
      moderationNotesRef: null,
      originType: input.originType,
      originPlatform: input.originPlatform ?? null,
      originSourceUrl: input.originSourceUrl ?? null,
      latestIngestRunId: input.latestIngestRunId ?? null,
      schemaVersion: COLLECTION_SCHEMA_VERSION,
      extensions: {},
    };
    this.collections.set(id, collection);
    return collection;
  }

  async getCollection(id: string): Promise<Collection | null> {
    return this.collections.get(id) ?? null;
  }

  async getCollectionBySlug(slug: string): Promise<Collection | null> {
    for (const c of this.collections.values()) {
      if (c.slug === slug) return c;
    }
    return null;
  }

  async updateCollection(id: string, patch: UpdateCollectionPatch): Promise<Collection> {
    const existing = this.collections.get(id);
    if (!existing) throw new Error('not found');
    const updated: Collection = {
      ...existing,
      ...patch,
      id: existing.id,
      creatorId: existing.creatorId,
      createdAt: existing.createdAt,
      updatedAt: now(),
      slug: patch.slug ?? existing.slug,
    };
    this.collections.set(id, updated);
    return updated;
  }

  async getAggregate(id: string): Promise<CollectionAggregate | null> {
    const collection = await this.getCollection(id);
    if (!collection) return null;
    return {
      collection,
      media: await this.listMedia(id),
      tags: await this.listTags(id),
    };
  }

  async insertMedia(input: CreateMediaInput): Promise<CollectionMedia> {
    const id = input.id ?? randomUUID();
    const ts = now();
    const media: CollectionMedia = {
      id,
      collectionId: input.collectionId,
      isPrimary: input.isPrimary ?? true,
      sourceProvider: input.sourceProvider ?? null,
      mediaKind: input.mediaKind ?? 'video',
      externalId: input.externalId ?? null,
      canonicalUrl: input.canonicalUrl ?? input.sourceUrl ?? null,
      sourceUrl: input.sourceUrl ?? null,
      embedUrl: input.embedUrl ?? null,
      title: input.title ?? null,
      providerCreatorId: input.providerCreatorId ?? null,
      providerCreatorName: input.providerCreatorName ?? null,
      thumbnailUrl: input.thumbnailUrl ?? null,
      durationMs: input.durationMs ?? null,
      aspectRatio: input.aspectRatio ?? null,
      language: input.language ?? null,
      region: input.region ?? null,
      sourcePublishedAt: input.sourcePublishedAt ?? null,
      sourceAvailability: input.sourceAvailability ?? 'unknown',
      processingStatus: input.processingStatus ?? 'imported',
      transcriptStatus: input.transcriptStatus ?? 'not_started',
      mediaUnderstandingStatus: input.mediaUnderstandingStatus ?? 'not_started',
      latestProcessingJobId: input.latestProcessingJobId ?? null,
      latestArtifactBundleRef: input.latestArtifactBundleRef ?? null,
      providerMetadataVersion: input.providerMetadataVersion ?? null,
      lastMetadataSyncedAt: input.lastMetadataSyncedAt ?? null,
      lastProcessedAt: input.lastProcessedAt ?? null,
      lastProcessingErrorCode: input.lastProcessingErrorCode ?? null,
      processingAttemptCount: input.processingAttemptCount ?? 0,
      schemaVersion: input.schemaVersion ?? 1,
      extensions: input.extensions ?? {},
      createdAt: ts,
      updatedAt: ts,
    };
    this.media.set(id, media);
    return media;
  }

  async listMedia(collectionId: string): Promise<CollectionMedia[]> {
    return [...this.media.values()]
      .filter((m) => m.collectionId === collectionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async updateMedia(
    id: string,
    patch: Partial<Omit<CollectionMedia, 'id' | 'collectionId' | 'createdAt'>>,
  ): Promise<CollectionMedia> {
    const existing = this.media.get(id);
    if (!existing) throw new Error('not found');
    const updated = { ...existing, ...patch, updatedAt: now() };
    this.media.set(id, updated);
    return updated;
  }

  async deleteMedia(id: string): Promise<void> {
    this.media.delete(id);
  }

  async insertTag(input: CreateTagInput): Promise<CollectionProductTag> {
    const id = input.id ?? randomUUID();
    const ts = now();
    const strength =
      input.recommendationStrength ??
      (input.isPrimary ? 'PRIMARY' : 'SECONDARY');
    const selection =
      input.selectionSource ??
      (input.tagSource ? mapLegacyTagSource(input.tagSource) : 'AI_DETECTED');
    if (input.catalogProductId) {
      for (const t of this.tags.values()) {
        if (
          t.collectionId === input.collectionId &&
          !t.deletedAt &&
          t.catalogProductId === input.catalogProductId
        ) {
          throw new Error('duplicate catalog product on collection');
        }
      }
    }
    const tag: CollectionProductTag = {
      id,
      collectionId: input.collectionId,
      catalogProductId: input.catalogProductId ?? null,
      sortOrder: input.sortOrder ?? 0,
      isPrimary: strength === 'PRIMARY',
      recommendationStrength: strength,
      tagSource: input.tagSource ?? toLegacyTagSource(selection),
      selectionSource: selection,
      tagStatus: input.tagStatus ?? 'proposed',
      visibility: input.visibility ?? 'visible',
      creatorNote: input.creatorNote ?? null,
      creatorAction: input.creatorAction ?? null,
      detectionSource: input.detectionSource ?? null,
      reason: input.reason ?? null,
      evidenceRefs: input.evidenceRefs ?? [],
      recommendedBy: input.recommendedBy ?? null,
      confidence: input.confidence ?? null,
      frameCues: input.frameCues ?? [],
      includeInPublish: input.includeInPublish ?? true,
      nameSnapshot: input.nameSnapshot ?? null,
      imageSnapshot: input.imageSnapshot ?? null,
      brandSnapshot: input.brandSnapshot ?? null,
      categorySnapshot: input.categorySnapshot ?? null,
      snapshotUpdatedAt:
        input.snapshotUpdatedAt ??
        (input.nameSnapshot || input.imageSnapshot || input.brandSnapshot || input.categorySnapshot
          ? ts
          : null),
      resolutionStatus: input.resolutionStatus ?? null,
      externalId: input.externalId ?? null,
      merchantUrl: input.merchantUrl ?? null,
      acceptedAt: input.acceptedAt ?? null,
      firstPublishedAt: input.firstPublishedAt ?? null,
      rejectedAt: null,
      archivedAt: null,
      deletedAt: null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.tags.set(id, tag);
    return tag;
  }

  async listTags(
    collectionId: string,
    opts?: { includeDeleted?: boolean },
  ): Promise<CollectionProductTag[]> {
    return [...this.tags.values()]
      .filter((t) => t.collectionId === collectionId)
      .filter((t) => (opts?.includeDeleted ? true : !t.deletedAt && t.tagStatus !== 'deleted'))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async listTagsByCatalogProductId(catalogProductId: string): Promise<CollectionProductTag[]> {
    return [...this.tags.values()].filter(
      (t) =>
        t.catalogProductId === catalogProductId &&
        !t.deletedAt &&
        t.tagStatus !== 'deleted',
    );
  }

  async updateTag(id: string, patch: UpdateTagPatch): Promise<CollectionProductTag> {
    const existing = this.tags.get(id);
    if (!existing) throw new Error('not found');
    let strength = patch.recommendationStrength ?? existing.recommendationStrength;
    if (patch.isPrimary === true) strength = 'PRIMARY';
    if (patch.isPrimary === false && strength === 'PRIMARY') strength = 'SECONDARY';
    if (patch.catalogProductId) {
      for (const t of this.tags.values()) {
        if (
          t.id !== id &&
          t.collectionId === existing.collectionId &&
          !t.deletedAt &&
          t.catalogProductId === patch.catalogProductId
        ) {
          throw new Error('duplicate catalog product on collection');
        }
      }
    }
    const updated: CollectionProductTag = {
      ...existing,
      ...patch,
      recommendationStrength: strength,
      isPrimary: strength === 'PRIMARY',
      updatedAt: now(),
    };
    this.tags.set(id, updated);
    return updated;
  }

  async deleteTag(id: string): Promise<void> {
    const existing = this.tags.get(id);
    if (!existing) return;
    this.tags.set(id, {
      ...existing,
      tagStatus: 'deleted',
      deletedAt: now(),
      visibility: 'hidden',
      includeInPublish: false,
      updatedAt: now(),
    });
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
    await this.updateCollection(id, { ...fields });
  }

  async applyCounters(id: string, counters: Partial<MaterializedCounters>): Promise<void> {
    await this.updateCollection(id, {
      ...counters,
      countersUpdatedAt: counters.countersUpdatedAt ?? now(),
    });
  }

  async applyQualitySignals(id: string, signals: Partial<QualitySignals>): Promise<void> {
    await this.updateCollection(id, {
      ...signals,
      qualitySignalsUpdatedAt: signals.qualitySignalsUpdatedAt ?? now(),
    });
  }

  async hideCreatorFromDiscovery(creatorId: string): Promise<void> {
    for (const c of this.collections.values()) {
      if (c.creatorId !== creatorId) continue;
      await this.updateCollection(c.id, {
        feedEligible: false,
        searchEligible: false,
        recsEligible: false,
      });
    }
  }

  async restoreCreatorDiscovery(creatorId: string): Promise<void> {
    for (const c of this.collections.values()) {
      if (c.creatorId !== creatorId) continue;
      if (c.deletedAt) continue;
      const eligible =
        c.status === 'published' &&
        c.visibility === 'public' &&
        c.moderationState === 'clear';
      await this.updateCollection(c.id, {
        feedEligible: eligible,
        searchEligible: eligible,
        recsEligible: eligible,
      });
    }
  }

  async listPublishedPublicByCreator(
    creatorId: string,
    opts: { limit: number; cursor?: { publishedAt: string; id: string } | null },
  ): Promise<Collection[]> {
    const eligible = [...this.collections.values()].filter(
      (c) =>
        c.creatorId === creatorId &&
        !c.deletedAt &&
        c.status === 'published' &&
        c.visibility === 'public' &&
        c.moderationState === 'clear' &&
        c.publishedAt != null,
    );
    eligible.sort((a, b) => {
      const pa = a.publishedAt ?? '';
      const pb = b.publishedAt ?? '';
      if (pa !== pb) return pb.localeCompare(pa);
      return b.id.localeCompare(a.id);
    });
    const cursor = opts.cursor;
    const filtered = cursor
      ? eligible.filter((c) => {
          const p = c.publishedAt ?? '';
          if (p < cursor.publishedAt) return true;
          if (p > cursor.publishedAt) return false;
          return c.id < cursor.id;
        })
      : eligible;
    return filtered.slice(0, opts.limit);
  }

  async sumPublishedCollectionSaves(creatorId: string): Promise<number> {
    let sum = 0;
    for (const c of this.collections.values()) {
      if (
        c.creatorId === creatorId &&
        !c.deletedAt &&
        c.status === 'published' &&
        c.visibility === 'public' &&
        c.moderationState === 'clear'
      ) {
        sum += c.savesCount;
      }
    }
    return sum;
  }

  async listPublishedCreatorProductTagRows(
    creatorId: string,
    opts: { limit: number; afterCatalogProductId?: string | null },
  ): Promise<PublishedCreatorProductTagRow[]> {
    const publishedIds = new Set(
      [...this.collections.values()]
        .filter(
          (c) =>
            c.creatorId === creatorId &&
            !c.deletedAt &&
            c.status === 'published' &&
            c.visibility === 'public' &&
            c.moderationState === 'clear',
        )
        .map((c) => c.id),
    );
    const after = opts.afterCatalogProductId?.trim() || null;
    const rows: PublishedCreatorProductTagRow[] = [];
    for (const t of this.tags.values()) {
      if (!publishedIds.has(t.collectionId)) continue;
      if (t.deletedAt) continue;
      if (t.visibility !== 'visible') continue;
      if (t.includeInPublish === false) continue;
      if (!t.catalogProductId) continue;
      if (after && t.catalogProductId <= after) continue;
      const col = this.collections.get(t.collectionId);
      rows.push({
        catalogProductId: t.catalogProductId,
        nameSnapshot: t.nameSnapshot,
        imageSnapshot: t.imageSnapshot,
        brandSnapshot: t.brandSnapshot,
        resolutionStatus: t.resolutionStatus,
        collectionId: t.collectionId,
        collectionTitle: col?.title ?? null,
      });
    }
    rows.sort((a, b) => a.catalogProductId.localeCompare(b.catalogProductId));
    return rows.slice(0, opts.limit);
  }
}
