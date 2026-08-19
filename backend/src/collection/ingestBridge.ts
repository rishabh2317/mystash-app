import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthUserLike } from './auth';
import { createCollectionService } from './factory';
import type { CollectionOriginType } from './domain/types';
import { transformToEmbedUrl } from '../pipeline/embed';
import { detectPlatform } from '../pipeline/detect';
import { createUserService } from '../user/factory';

/**
 * Create Collection + primary media for a new ingest, link ingest_requests.collection_id.
 */
export async function ensureCollectionForIngest(
  admin: SupabaseClient,
  params: {
    user: AuthUserLike;
    ingestId: string;
    sourceUrl: string;
    platform: string;
    title?: string | null;
    thumbnailUrl?: string | null;
    originType?: CollectionOriginType;
    qualityScore?: number | null;
    startProcessing?: boolean;
  },
): Promise<string> {
  const users = createUserService(admin);
  await users.ensureFromAuth(params.user);
  const svc = createCollectionService(admin);
  const originType = params.originType ?? 'url_ingest';
  const collection = await svc.createDraft({
    user: params.user,
    title: params.title ?? null,
    originType,
    originPlatform: params.platform,
    originSourceUrl: params.sourceUrl,
    qualityScore: params.qualityScore ?? 4.5,
    status: params.startProcessing === false ? 'draft' : 'draft',
  });

  const platform = params.platform || detectPlatform(params.sourceUrl);
  const embedUrl = transformToEmbedUrl(params.sourceUrl, platform) ?? params.sourceUrl;

  await svc.attachPrimaryExternalSource({
    collectionId: collection.id,
    userId: params.user.id,
    sourceUrl: params.sourceUrl,
    embedUrl,
    thumbnailUrl: params.thumbnailUrl ?? null,
    title: params.title ?? null,
    sourceProvider: platform === 'unknown' ? 'web' : platform,
  });

  if (params.startProcessing !== false) {
    await svc.startProcessing({
      collectionId: collection.id,
      userId: params.user.id,
      ingestRunId: params.ingestId,
    });
    await svc.startMediaProcessing({
      collectionId: collection.id,
      jobId: params.ingestId,
    });
  }

  await admin
    .from('ingest_requests')
    .update({ collection_id: collection.id, updated_at: new Date().toISOString() })
    .eq('id', params.ingestId);

  return collection.id;
}

/** Sync draft products → collection_product_tags and set review status. */
export async function syncCollectionFromIngestDrafts(
  admin: SupabaseClient,
  params: {
    ingestId: string;
    collectionId: string;
    status: 'ready_for_review' | 'review_required';
    title?: string | null;
    thumbnailUrl?: string | null;
  },
): Promise<void> {
  const { data: drafts } = await admin
    .from('ingest_draft_products')
    .select(
      'external_id, name, image, brand, category, confidence, catalog_product_id, resolution_status, merchant_url, sort_order, provider',
    )
    .eq('ingest_request_id', params.ingestId)
    .order('sort_order', { ascending: true });

  const svc = createCollectionService(admin);
  const aggregate = await svc.getAggregate(params.collectionId);
  const originManual = aggregate?.collection.originType === 'manual_curation';
  const tagSource = (provider: string | null): 'ai' | 'manual' | 'import' => {
    if (originManual || provider === 'manual' || provider === 'manual_links') return 'manual';
    return 'ai';
  };

  await svc.applyIngestResult({
    collectionId: params.collectionId,
    status: params.status,
    title: params.title ?? null,
    thumbnailUrl: params.thumbnailUrl ?? null,
    ingestRunId: params.ingestId,
    proposedTags: (drafts ?? []).map((d, i) => {
      const legacy = tagSource((d.provider as string) ?? null);
      return {
        collectionId: params.collectionId,
        tagSource: legacy,
        selectionSource: legacy === 'manual' ? ('CREATOR_MANUAL' as const) : ('AI_DETECTED' as const),
        externalId: String(d.external_id),
        nameSnapshot: String(d.name),
        imageSnapshot: (d.image as string) ?? null,
        brandSnapshot: (d.brand as string) ?? null,
        categorySnapshot: (d.category as string) ?? null,
        confidence: d.confidence == null ? null : Number(d.confidence),
        catalogProductId: (d.catalog_product_id as string) ?? null,
        resolutionStatus:
          (d.resolution_status as 'VERIFIED' | 'UNVERIFIED' | 'UNRESOLVED' | null) ??
          'UNRESOLVED',
        merchantUrl: (d.merchant_url as string) ?? null,
        sortOrder: d.sort_order == null ? i : Number(d.sort_order),
        recommendationStrength: i === 0 ? ('PRIMARY' as const) : ('SECONDARY' as const),
        isPrimary: i === 0,
        includeInPublish: true,
        tagStatus: 'proposed' as const,
        visibility: 'visible' as const,
      };
    }),
  });

  if (params.title || params.thumbnailUrl) {
    try {
      await svc.syncMediaMetadata({
        collectionId: params.collectionId,
        title: params.title ?? undefined,
        thumbnailUrl: params.thumbnailUrl ?? undefined,
        sourceAvailability: 'available',
      });
    } catch {
      /* media may not exist on legacy rows */
    }
  }

  try {
    await svc.completeMediaProcessing({
      collectionId: params.collectionId,
      jobId: params.ingestId,
      artifactBundleRef: params.ingestId,
    });
  } catch {
    /* already ready or missing */
  }
}

/**
 * Lazy-create Collection for legacy ingest rows missing collection_id (publish path).
 */
export async function ensureCollectionLinkedToIngest(
  admin: SupabaseClient,
  params: {
    user: AuthUserLike;
    ingestId: string;
    sourceUrl: string;
    platform: string;
    title?: string | null;
    thumbnailUrl?: string | null;
    existingCollectionId?: string | null;
    statusHint?: 'ready_for_review' | 'review_required' | 'draft' | 'processing';
  },
): Promise<string> {
  if (params.existingCollectionId) return params.existingCollectionId;

  const users = createUserService(admin);
  await users.ensureFromAuth(params.user);
  const svc = createCollectionService(admin);
  const collection = await svc.createDraft({
    user: params.user,
    title: params.title ?? null,
    originType: 'url_ingest',
    originPlatform: params.platform,
    originSourceUrl: params.sourceUrl,
    qualityScore: 4.5,
    status: params.statusHint === 'processing' ? 'processing' : 'ready_for_review',
  });

  const platform = params.platform || detectPlatform(params.sourceUrl);
  const embedUrl = transformToEmbedUrl(params.sourceUrl, platform) ?? params.sourceUrl;
  await svc.attachPrimaryExternalSource({
    collectionId: collection.id,
    userId: params.user.id,
    sourceUrl: params.sourceUrl,
    embedUrl,
    thumbnailUrl: params.thumbnailUrl ?? null,
    title: params.title ?? null,
    sourceProvider: platform === 'unknown' ? 'web' : platform,
  });

  await admin
    .from('ingest_requests')
    .update({ collection_id: collection.id, updated_at: new Date().toISOString() })
    .eq('id', params.ingestId);

  await syncCollectionFromIngestDrafts(admin, {
    ingestId: params.ingestId,
    collectionId: collection.id,
    status:
      params.statusHint === 'review_required' ? 'review_required' : 'ready_for_review',
    title: params.title ?? null,
    thumbnailUrl: params.thumbnailUrl ?? null,
  });

  return collection.id;
}

/** Worker-safe: mark media processing started for a collection. */
export async function notifyMediaProcessingStarted(
  admin: SupabaseClient,
  collectionId: string,
  jobId: string,
): Promise<void> {
  const svc = createCollectionService(admin);
  try {
    await svc.startMediaProcessing({
      collectionId,
      jobId,
      artifactBundleRef: jobId,
    });
  } catch {
    /* legacy ingest without media */
  }
}

/**
 * Re-run a failed ingest on the same Collection (media failed → processing).
 * Does not create a new Collection or ingest_requests row.
 */
export async function resumeFailedIngestForRetry(
  admin: SupabaseClient,
  params: { ingestId: string; collectionId: string | null },
): Promise<void> {
  await admin
    .from('ingest_requests')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', params.ingestId);

  if (!params.collectionId) return;
  await notifyMediaProcessingStarted(admin, params.collectionId, params.ingestId);
}

/** Worker-safe: sync metadata and complete/fail media processing. */
export async function notifyMediaProcessingFinished(
  admin: SupabaseClient,
  params: {
    collectionId: string;
    jobId: string;
    ok: boolean;
    title?: string | null;
    thumbnailUrl?: string | null;
    providerCreatorName?: string | null;
    providerCreatorId?: string | null;
    errorCode?: string;
    sourceAvailability?: 'available' | 'unavailable' | 'restricted';
  },
): Promise<void> {
  const svc = createCollectionService(admin);
  try {
    if (params.title || params.thumbnailUrl || params.providerCreatorName || params.providerCreatorId) {
      await svc.syncMediaMetadata({
        collectionId: params.collectionId,
        title: params.title ?? undefined,
        thumbnailUrl: params.thumbnailUrl ?? undefined,
        providerCreatorId: params.providerCreatorId ?? undefined,
        providerCreatorName: params.providerCreatorName ?? undefined,
        sourceAvailability: params.ok ? 'available' : params.sourceAvailability,
      });
    }
    if (params.ok) {
      await svc.completeMediaProcessing({
        collectionId: params.collectionId,
        jobId: params.jobId,
        artifactBundleRef: params.jobId,
      });
    } else {
      await svc.failMediaProcessing({
        collectionId: params.collectionId,
        jobId: params.jobId,
        artifactBundleRef: params.jobId,
        errorCode: params.errorCode ?? 'PROCESSING_FAILED',
      });
      if (params.sourceAvailability === 'unavailable' || params.sourceAvailability === 'restricted') {
        try {
          await svc.markSourceUnavailable({
            collectionId: params.collectionId,
            availability: params.sourceAvailability,
          });
        } catch {
          /* media already failed */
        }
      }
    }
  } catch {
    /* legacy ingest without media */
  }
}
