import type { Request, Response } from 'express';
import { createSupabaseAdmin, createSupabaseUserClient } from './supabase';
import { wrapAffiliateDestination } from './pipeline/affiliate';
import { detectPlatform, extractYouTubeVideoId } from './pipeline/detect';
import { transformToEmbedUrl } from './pipeline/embed';
import { NoopCatalogMatcher } from './products/catalogMatcher';
import { resolveSelectedDraftProducts } from './publishResolveDrafts';
import { logger } from './logger';

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

    // Catalog match (stub) then affiliate wrap — never during extraction.
    await new NoopCatalogMatcher().match(
      drafts.map((d) => ({
        name: d.name,
        category: 'unknown',
        brand: null,
        model: null,
        confidence: 1,
        evidence: {
          summary: '',
          frames: [],
          frameCount: 0,
          logoHits: [],
          transcriptMentions: false,
          ocrMentions: false,
        },
        sources: [],
        externalId: d.external_id,
        merchantUrl: d.affiliate_url ?? undefined,
      })),
    );

    const productInserts = await Promise.all(
      drafts.map(async (d, i) => {
        const destination =
          d.affiliate_url && d.affiliate_url.startsWith('http')
            ? d.affiliate_url
            : `https://www.google.com/search?q=${encodeURIComponent(d.name)}`;
        const wrapped = await wrapAffiliateDestination(destination, {
          ingestId,
          index: i,
        });
        return {
          video_id: videoId,
          name: d.name,
          price: d.price,
          image: d.image || 'https://picsum.photos/seed/vp/400/400',
          affiliate_url: wrapped.affiliateUrl,
          provider: wrapped.provider === 'fallback' ? d.provider || 'canonical' : wrapped.provider,
          sort_order: i,
        };
      }),
    );

    await admin.from('video_products').insert(productInserts);

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
