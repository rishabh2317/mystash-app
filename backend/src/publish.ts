import type { Request, Response } from 'express';
import { createSupabaseAdmin, createSupabaseUserClient } from './supabase';
import { detectPlatform, extractYouTubeVideoId } from './pipeline/detect';
import { transformToEmbedUrl } from './pipeline/embed';
import { getProductIntelligenceConfig } from './product-intelligence/config';
import { enqueueProductResolve } from './product-intelligence/jobs/productResolveQueue';
import { resolveSelectedDraftProducts } from './publishResolveDrafts';
import { logger } from './logger';
import { validHttpUrl } from './shopping/urlValidation';

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
      .select('id, user_id, source_url, platform, status, video_title, thumbnail, stash_score')
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

    if (body.reject_all) {
      await admin
        .from('ingest_requests')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', ingestId);
      await admin.from('moderation_actions').insert({
        ingest_request_id: ingestId,
        user_id: user.id,
        action: 'reject_all',
        meta: {},
      });
      res.json({ ok: true });
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

    const { data: videoRow, error: vErr } = await admin
      .from('videos')
      .insert({
        url: sourceUrl,
        thumbnail: thumb,
        creator_name: handle,
        stash_score: Number(ingest.stash_score) || 4.5,
        product_name: first.name,
        embed_url: embedUrl,
        video_title: (ingest.video_title as string) || first.name,
        curator_id: `@${handle}`,
      })
      .select('id')
      .single();

    if (vErr || !videoRow) {
      res.status(500).json({ error: 'Failed to create video', detail: vErr?.message });
      return;
    }

    const videoId = videoRow.id as string;
    const backgroundResolve = getProductIntelligenceConfig().backgroundResolve;

    // Validation only: name required. External/catalog failures must not block publish.
    for (const d of drafts) {
      if (!String(d.name ?? '').trim()) {
        res.status(400).json({ error: 'Invalid draft product: missing name' });
        return;
      }
    }

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

    const productInserts = [];
    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i]!;
      let cat: CatalogRow | undefined = d.catalog_product_id
        ? catalogById.get(d.catalog_product_id)
        : undefined;

      // Guarantee catalog SoT before publish — create UNRESOLVED placeholder if missing.
      if (!cat) {
        const { data: created, error: cErr } = await admin
          .from('catalog_products')
          .insert({
            canonical_slug: `publish-${d.id}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            name: d.name,
            normalized_name: d.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
            image_url: d.image,
            merchant_url: d.merchant_url,
            preferred_shopping_url: d.merchant_url,
            shopping_provider: d.merchant_url ? 'merchant' : null,
            price: d.price,
            status: 'ACTIVE',
            verification_status: 'UNRESOLVED',
            verification_source: 'publish_placeholder',
            metadata: { source: 'publish_ensure_catalog' },
            updated_at: new Date().toISOString(),
          })
          .select(
            'id, name, price, image_url, merchant, merchant_url, preferred_shopping_url, shopping_provider, verification_status',
          )
          .single();
        if (cErr || !created) {
          res.status(500).json({ error: 'Could not persist catalog product', detail: cErr?.message });
          return;
        }
        cat = created as CatalogRow;
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
      // Prefer catalog commerce destination when present; never overwrite with merchantUrl.
      const preferredShoppingUrl =
        validHttpUrl(cat.preferred_shopping_url) ?? merchantUrl;
      if (merchantUrl && !validHttpUrl(cat.preferred_shopping_url)) {
        await admin
          .from('catalog_products')
          .update({
            preferred_shopping_url: preferredShoppingUrl,
            shopping_provider: cat.shopping_provider ?? 'merchant',
            updated_at: new Date().toISOString(),
          })
          .eq('id', cat.id);
      }

      const resolutionStatus =
        cat.verification_status === 'VERIFIED' ||
        cat.verification_status === 'UNVERIFIED' ||
        cat.verification_status === 'UNRESOLVED'
          ? cat.verification_status
          : 'UNRESOLVED';

      // Denormalized cache on video_products mirrors catalog for offline; UI reads catalog join.
      productInserts.push({
        video_id: videoId,
        name: cat.name,
        price: cat.price || d.price || '—',
        image: cat.image_url || d.image || 'https://picsum.photos/seed/vp/400/400',
        merchant_url: merchantUrl,
        // This column is affiliate-only. ShoppingResolver handles merchant fallback.
        affiliate_url: null,
        provider: cat.merchant || d.provider || 'catalog',
        sort_order: i,
        catalog_product_id: cat.id,
        resolution_status: resolutionStatus,
      });
    }

    const { data: inserted, error: vpErr } = await admin
      .from('video_products')
      .insert(productInserts)
      .select('id, catalog_product_id, resolution_status');

    if (vpErr) {
      res.status(500).json({ error: 'Failed to save video products', detail: vpErr.message });
      return;
    }

    // Background resolve for UNRESOLVED published products (never blocks publish).
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
        updated_at: new Date().toISOString(),
      })
      .eq('id', ingestId);

    await admin.from('moderation_actions').insert({
      ingest_request_id: ingestId,
      user_id: user.id,
      action: 'publish',
      meta: { video_id: videoId, product_count: drafts.length },
    });

    res.json({ ok: true, videoId });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message ?? 'Server error' });
  }
}
