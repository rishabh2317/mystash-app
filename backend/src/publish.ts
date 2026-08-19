import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { createSupabaseAdmin, createSupabaseUserClient } from './supabase';
import { detectPlatform, extractYouTubeVideoId } from './pipeline/detect';
import { transformToEmbedUrl } from './pipeline/embed';
import { getProductIntelligenceConfig } from './product-intelligence/config';
import { enqueueProductResolve } from './product-intelligence/jobs/productResolveQueue';
import { resolveSelectedDraftProducts } from './publishResolveDrafts';
import { logger } from './logger';
import { validHttpUrl } from './shopping/urlValidation';
import { createCollectionService } from './collection/factory';
import {
  ensureCollectionLinkedToIngest,
} from './collection/ingestBridge';
import { createCatalogService } from './catalog/factory';
import { composeCollectionTagRemaps } from './catalog/ports';
import { createCollectionTagRemapPort } from './collection/catalogRemap';
import { createCartItemRemapPort, createCartService } from './cart/factory';
import {
  assertIndependentVideoAndCollectionIds,
  buildVideoProductInserts,
  resolvePublishVideoId,
  type VideoProductInsertDraft,
} from './publishVideoProjection';

export async function handlePublishIngest(req: Request, res: Response): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || typeof authHeader !== 'string') {
      res.status(401).json({ error: 'Missing authorization' });
      return;
    }

    const userClient = createSupabaseUserClient(authHeader);
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const admin = createSupabaseAdmin();
    const collectionService = createCollectionService(admin);
    const cartService = createCartService(admin);
    const catalogService = createCatalogService(
      admin,
      composeCollectionTagRemaps(
        createCollectionTagRemapPort(collectionService),
        createCartItemRemapPort(cartService),
      ),
    );

    const body = req.body as {
      ingest_id?: string;
      selected_product_ids?: string[];
      source_url?: string;
      platform?: string;
      reject_all?: boolean;
    };

    const ingestId = body.ingest_id?.trim();
    if (!ingestId) {
      res.status(400).json({ error: 'ingest_id required' });
      return;
    }

    const { data: ingest, error: ingErr } = await admin
      .from('ingest_requests')
      .select(
        'id, user_id, source_url, platform, status, video_title, thumbnail, stash_score, collection_id',
      )
      .eq('id', ingestId)
      .maybeSingle();

    if (ingErr || !ingest || ingest.user_id !== user.id) {
      res.status(404).json({ error: 'Ingest not found' });
      return;
    }

    if (ingest.status === 'published' || ingest.status === 'rejected') {
      res.json({ ok: true, videoId: null, message: 'Already finalized' });
      return;
    }

    const authUser = {
      id: user.id,
      email: user.email,
      user_metadata: user.user_metadata as Record<string, unknown>,
    };

    if (body.reject_all) {
      await admin
        .from('ingest_requests')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', ingestId);

      if (ingest.collection_id) {
        try {
          await collectionService.reject({
            collectionId: String(ingest.collection_id),
            userId: user.id,
          });
        } catch (e) {
          logger.warn({ err: e, ingestId }, 'publish.collection_reject_failed');
        }
      }

      await admin.from('moderation_actions').insert({
        ingest_request_id: ingestId,
        user_id: user.id,
        action: 'reject_all',
        meta: {},
      });
      res.json({ ok: true });
      return;
    }

    if (ingest.status === 'failed' || ingest.status === 'processing') {
      res.status(409).json({
        error:
          ingest.status === 'failed'
            ? 'This ingest failed. Retry the source URL from Create — do not publish a failed Collection.'
            : 'Extraction is still running. Wait until review is ready before publishing.',
      });
      return;
    }

    const selected = body.selected_product_ids ?? [];
    if (selected.length < 1) {
      res.status(400).json({ error: 'Select at least one product to publish' });
      return;
    }

    let resolveResult: Awaited<ReturnType<typeof resolveSelectedDraftProducts>>;
    try {
      resolveResult = await resolveSelectedDraftProducts(admin, ingestId, selected);
    } catch (e) {
      logger.error({ err: e, ingestId }, 'publish.draft_load_failed');
      res.status(500).json({ error: 'Could not load draft products' });
      return;
    }

    const { drafts, totalDraftRows } = resolveResult;

    if (!drafts.length) {
      const detail =
        totalDraftRows === 0
          ? 'No products are saved for this ingest in the database. Re-open the item from Create → Your drafts, or run extraction / manual fetch again.'
          : `This ingest has ${totalDraftRows} saved product(s), but none of the IDs sent from the app matched their external_id. Reload the review screen or reopen the draft.`;
      logger.warn(
        {
          ingestId,
          selectedCount: selected.length,
          totalDraftRows,
          unmatchedCount: resolveResult.unmatchedSelectedIds.length,
        },
        'publish.no_matching_drafts',
      );
      res.status(400).json({ error: 'No matching draft products', detail });
      return;
    }

    const sourceUrl = ingest.source_url as string;
    const platform = (ingest.platform as string) || detectPlatform(sourceUrl);
    const ytId = platform === 'youtube' ? extractYouTubeVideoId(sourceUrl) : null;
    const thumb =
      (ingest.thumbnail as string) ||
      (ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : 'https://picsum.photos/seed/publish/640/1136');
    const embedUrl = transformToEmbedUrl(sourceUrl, platform) ?? sourceUrl;
    const first = drafts[0]!;
    const meta = user.user_metadata as Record<string, string | undefined>;
    const handle =
      (meta?.preferred_username as string) ||
      (meta?.user_name as string) ||
      user.email?.split('@')[0] ||
      'curator';

    for (const d of drafts) {
      if (!String(d.name ?? '').trim()) {
        res.status(400).json({ error: 'Invalid draft product: missing name' });
        return;
      }
    }

    let collectionId: string;
    try {
      collectionId = await ensureCollectionLinkedToIngest(admin, {
        user: authUser,
        ingestId,
        sourceUrl,
        platform,
        title: (ingest.video_title as string) || first.name,
        thumbnailUrl: thumb,
        existingCollectionId: (ingest.collection_id as string) ?? null,
        statusHint: 'ready_for_review',
      });
    } catch (e) {
      logger.error({ err: e, ingestId }, 'publish.collection_ensure_failed');
      res.status(500).json({ error: 'Could not prepare collection', detail: (e as Error).message });
      return;
    }

    // Sync selected drafts into collection tags before publish.
    try {
      const { syncCollectionFromIngestDrafts } = await import('./collection/ingestBridge');
      await syncCollectionFromIngestDrafts(admin, {
        ingestId,
        collectionId,
        status: 'ready_for_review',
        title: (ingest.video_title as string) || first.name,
        thumbnailUrl: thumb,
      });
    } catch (e) {
      logger.warn({ err: e, ingestId, collectionId }, 'publish.collection_tag_sync_failed');
    }

    let publishedCollection;
    try {
      publishedCollection = await collectionService.publish({
        collectionId,
        userId: user.id,
        user: authUser,
        visibility: 'public',
        includeExternalIds: selected,
      });
    } catch (e) {
      const msg = (e as Error).message ?? 'Publish failed';
      const code = (e as { statusCode?: number }).statusCode ?? 400;
      res.status(code).json({ error: msg });
      return;
    }

    const newVideoId = crypto.randomUUID();
    const backgroundResolve = getProductIntelligenceConfig().backgroundResolve;

    const catalogIds = [
      ...new Set(
        drafts.map((d) => d.catalog_product_id).filter((id): id is string => !!id),
      ),
    ];
    type CatalogRow = {
      id: string;
      name: string;
      price: string | null;
      image_url: string | null;
      merchant: string | null;
      merchant_url: string | null;
      preferred_shopping_url: string | null;
      shopping_provider: string | null;
      verification_status: string | null;
    };
    const catalogById = new Map<string, CatalogRow>();
    if (catalogIds.length) {
      const { data: cats } = await admin
        .from('catalog_products')
        .select(
          'id, name, price, image_url, merchant, merchant_url, preferred_shopping_url, shopping_provider, verification_status',
        )
        .in('id', catalogIds);
      for (const c of cats ?? []) {
        catalogById.set(String((c as CatalogRow).id), c as CatalogRow);
      }
    }

    const productDrafts: VideoProductInsertDraft[] = [];
    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i]!;
      let cat: CatalogRow | undefined = d.catalog_product_id
        ? catalogById.get(d.catalog_product_id)
        : undefined;

      if (!cat) {
        try {
          const created = await catalogService.ensureUnresolvedPlaceholder({
            draftId: d.id,
            name: d.name,
            imageUrl: d.image,
            merchantUrl: d.merchant_url,
            price: d.price,
          });
          cat = {
            id: created.id,
            name: created.name,
            price: created.price,
            image_url: created.imageUrl,
            merchant: created.merchant,
            merchant_url: created.merchantUrl,
            preferred_shopping_url: created.preferredShoppingUrl,
            shopping_provider: created.shoppingProvider,
            verification_status: created.verificationStatus,
          };
        } catch (e) {
          res.status(500).json({
            error: 'Could not persist catalog product',
            detail: e instanceof Error ? e.message : String(e),
          });
          return;
        }
        catalogById.set(cat.id, cat);
        await admin
          .from('ingest_draft_products')
          .update({
            catalog_product_id: cat.id,
            resolution_status: 'UNRESOLVED',
          })
          .eq('id', d.id);
        d.catalog_product_id = cat.id;
        d.resolution_status = 'UNRESOLVED';
      }

      const merchantUrl = validHttpUrl(cat.merchant_url) ?? validHttpUrl(d.merchant_url);
      const preferredShoppingUrl =
        validHttpUrl(cat.preferred_shopping_url) ?? merchantUrl;
      if (merchantUrl && !validHttpUrl(cat.preferred_shopping_url)) {
        await catalogService.applyShoppingProjection(cat.id, {
          preferredShoppingUrl,
          shoppingProvider: cat.shopping_provider ?? 'merchant',
        });
        cat.preferred_shopping_url = preferredShoppingUrl;
        cat.shopping_provider = cat.shopping_provider ?? 'merchant';
      }

      const resolutionStatus =
        cat.verification_status === 'VERIFIED' ||
        cat.verification_status === 'UNVERIFIED' ||
        cat.verification_status === 'UNRESOLVED'
          ? cat.verification_status
          : 'UNRESOLVED';

      productDrafts.push({
        name: cat.name,
        price: cat.price || d.price || '—',
        image: cat.image_url || d.image || 'https://picsum.photos/seed/vp/400/400',
        merchant_url: merchantUrl,
        affiliate_url: null,
        provider: cat.merchant || d.provider || 'catalog',
        sort_order: i,
        catalog_product_id: cat.id,
        resolution_status: resolutionStatus,
      });
    }

    // Dual-write Home Feed video with independent ID + collection_id FK.
    const { data: existingVideo } = await admin
      .from('videos')
      .select('id')
      .eq('collection_id', collectionId)
      .maybeSingle();

    const { videoId, shouldInsertVideo } = resolvePublishVideoId({
      existingVideoId: existingVideo?.id ?? null,
      newVideoId,
    });
    assertIndependentVideoAndCollectionIds(videoId, collectionId);

    const videoRow = {
      url: sourceUrl,
      thumbnail: thumb,
      creator_name: handle,
      stash_score: Number(publishedCollection.qualityScore ?? ingest.stash_score) || 4.5,
      product_name: first.name,
      embed_url: embedUrl,
      video_title: (ingest.video_title as string) || first.name,
      curator_id: `@${handle}`,
      collection_id: collectionId,
    };

    if (shouldInsertVideo) {
      const { error: vErr } = await admin.from('videos').insert({
        id: videoId,
        ...videoRow,
      });

      if (vErr) {
        logger.error({ err: vErr, videoId, collectionId }, 'publish.video_dual_write_failed');
        res.status(500).json({
          error: 'Failed to create video',
          detail: vErr.message,
          collectionId,
        });
        return;
      }
    } else {
      const { error: vErr } = await admin.from('videos').update(videoRow).eq('id', videoId);
      if (vErr) {
        logger.error({ err: vErr, videoId, collectionId }, 'publish.video_dual_write_update_failed');
        res.status(500).json({
          error: 'Failed to update video',
          detail: vErr.message,
          collectionId,
        });
        return;
      }

      const { error: clearErr } = await admin.from('video_products').delete().eq('video_id', videoId);
      if (clearErr) {
        res.status(500).json({
          error: 'Failed to reset video products',
          detail: clearErr.message,
        });
        return;
      }
    }

    const productInserts = buildVideoProductInserts(videoId, productDrafts);

    const { data: inserted, error: vpErr } = await admin
      .from('video_products')
      .insert(productInserts)
      .select('id, catalog_product_id, resolution_status');

    if (vpErr) {
      res.status(500).json({ error: 'Failed to save video products', detail: vpErr.message });
      return;
    }

    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i]!;
      const row = inserted?.[i];
      if (
        row &&
        (d.resolution_status === 'UNRESOLVED' || !d.catalog_product_id) &&
        backgroundResolve
      ) {
        try {
          await enqueueProductResolve({
            draftId: d.id,
            ingestId,
            videoProductId: String(row.id),
          });
        } catch (e) {
          logger.warn({ err: e, draftId: d.id }, 'publish.enqueue_resolve_failed');
        }
      }
    }

    await admin
      .from('ingest_requests')
      .update({
        status: 'published',
        video_id: videoId,
        collection_id: collectionId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ingestId);

    await admin.from('moderation_actions').insert({
      ingest_request_id: ingestId,
      user_id: user.id,
      action: 'publish',
      meta: { video_id: videoId, collection_id: collectionId, product_count: drafts.length },
    });

    res.json({ ok: true, videoId, collectionId });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message ?? 'Server error' });
  }
}
