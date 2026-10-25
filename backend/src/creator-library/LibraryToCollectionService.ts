import type { SupabaseClient } from '@supabase/supabase-js';
import { CollectionService, CollectionServiceError } from '../collection/CollectionService';
import type { AuthUserLike } from '../collection/auth';
import { createCollectionService } from '../collection/factory';
import type { ContentSourceRecord, ContentSourceProductRecord } from '../content-source/domain/types';
import { SupabaseContentSourceRepository } from '../content-source/SupabaseContentSourceRepository';
import type { ContentSourceRepository } from '../content-source/ContentSourceRepository';
import type { CreatorLibraryRepository } from './CreatorLibraryRepository';
import { SupabaseCreatorLibraryRepository } from './SupabaseCreatorLibraryRepository';

export class LibraryToCollectionError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'LibraryToCollectionError';
  }
}

function eligible(product: ContentSourceProductRecord): boolean {
  return Boolean(product.catalogProductId || product.discoveredProductId);
}

export class LibraryToCollectionService {
  constructor(
    private readonly library: CreatorLibraryRepository,
    private readonly sources: ContentSourceRepository,
    private readonly collections: CollectionService,
  ) {}

  async listCollections(userId: string) {
    return this.collections.listEditable(userId);
  }

  async addLibraryItem(params: {
    user: AuthUserLike;
    contentSourceId: string;
    collectionId?: string | null;
    title?: string | null;
  }): Promise<{
    collectionId: string;
    createdCollection: boolean;
    mediaId: string;
    attachedProducts: number;
    alreadyPresent: boolean;
  }> {
    const owns = await this.library.userOwnsContentSource(params.user.id, params.contentSourceId);
    if (!owns) throw new LibraryToCollectionError('Library item not found', 404);
    const source = await this.sources.findById(params.contentSourceId);
    if (!source) throw new LibraryToCollectionError('Library item not found', 404);

    let createdCollection = false;
    let collectionId = params.collectionId?.trim() || '';
    if (!collectionId) {
      const draft = await this.collections.createDraft({
        user: params.user,
        title: params.title?.trim() || source.title || 'Collection',
        originType: 'manual_curation',
        originPlatform: source.platform,
        originSourceUrl: source.canonicalUrl,
      });
      collectionId = draft.id;
      createdCollection = true;
    }

    const media = await this.attachMedia(collectionId, params.user.id, source);
    const products = (await this.sources.listProducts(source.id)).filter(eligible);
    let attachedProducts = 0;
    for (const product of products) {
      const added = await this.attachProduct(collectionId, params.user.id, product);
      if (added) attachedProducts += 1;
    }
    const collection = await this.collections.markReadyForReview(collectionId, params.user.id);
    return {
      collectionId: collection.id,
      createdCollection,
      mediaId: media.id,
      attachedProducts,
      alreadyPresent: !createdCollection && attachedProducts === 0,
    };
  }

  private async ownedAggregate(collectionId: string, userId: string) {
    const aggregate = await this.collections.getAggregate(collectionId);
    if (!aggregate || aggregate.collection.creatorId !== userId || aggregate.collection.deletedAt) {
      throw new LibraryToCollectionError('Collection not found', 404);
    }
    return aggregate;
  }

  private async attachMedia(collectionId: string, userId: string, source: ContentSourceRecord) {
    const existing = (await this.ownedAggregate(collectionId, userId)).media;
    const match = existing.find(
      (row) => row.sourceProvider === source.platform && row.externalId === source.externalId,
    );
    if (match) return match;
    if (existing.length > 0) {
      throw new LibraryToCollectionError('Collection already has different content', 409);
    }
    try {
      return await this.collections.attachPrimaryExternalSource({
        collectionId,
        userId,
        sourceUrl: source.canonicalUrl,
        thumbnailUrl: source.thumbnailUrl ?? null,
        title: source.title ?? null,
        externalId: source.externalId,
        sourceProvider: source.platform,
        mediaKind: 'video',
      });
    } catch (e) {
      if (e instanceof CollectionServiceError) {
        throw new LibraryToCollectionError(e.message, e.statusCode);
      }
      throw e;
    }
  }

  private async attachProduct(
    collectionId: string,
    userId: string,
    product: ContentSourceProductRecord,
  ): Promise<boolean> {
    const tags = (await this.ownedAggregate(collectionId, userId)).tags;
    if (
      product.catalogProductId &&
      tags.some((tag) => tag.catalogProductId === product.catalogProductId && !tag.deletedAt)
    ) {
      return false;
    }
    if (
      product.discoveredProductId &&
      tags.some((tag) => tag.discoveredProductId === product.discoveredProductId && !tag.deletedAt)
    ) {
      return false;
    }
    const selection =
      product.attachmentSource === 'CAMPAIGN' || product.attachmentSource === 'BRAND_FEED'
        ? product.attachmentSource
        : product.attachmentSource === 'CREATOR_MANUAL'
          ? 'CREATOR_MANUAL'
          : 'AI_DETECTED';
    const campaignProductId =
      typeof product.evidence.campaignProductId === 'string' ? product.evidence.campaignProductId : null;
    try {
      await this.collections.addTag({
        collectionId,
        userId,
        tag: {
          catalogProductId: product.catalogProductId,
          discoveredProductId: product.discoveredProductId,
          campaignProductId,
          selectionSource: selection,
          tagSource: selection === 'AI_DETECTED' ? 'ai' : 'manual',
          nameSnapshot: product.name,
          brandSnapshot: product.brand,
          imageSnapshot: product.image,
          categorySnapshot: product.category,
          merchantUrl: product.merchantUrl,
          externalId: product.externalId,
          resolutionStatus: product.catalogProductId ? 'UNVERIFIED' : 'UNRESOLVED',
          includeInPublish: Boolean(product.catalogProductId),
          confidence: product.confidence,
        },
      });
      return true;
    } catch (e) {
      if (e instanceof CollectionServiceError && e.statusCode === 409) return false;
      if (e instanceof CollectionServiceError) {
        throw new LibraryToCollectionError(e.message, e.statusCode);
      }
      throw e;
    }
  }
}

export function createLibraryToCollectionService(admin: SupabaseClient): LibraryToCollectionService {
  return new LibraryToCollectionService(
    new SupabaseCreatorLibraryRepository(admin),
    new SupabaseContentSourceRepository(admin),
    createCollectionService(admin),
  );
}
