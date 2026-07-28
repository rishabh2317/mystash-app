import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { detectPlatform, extractYouTubeVideoId } from '../_shared/detect.ts';
import { transformToEmbedUrl } from '../_shared/embed.ts';
import { resolveSelectedDraftProducts } from '../_shared/publishResolveDrafts.ts';

/** @deprecated The Expo app uses the Node backend `POST /publish` instead. Kept for legacy or non-app callers. */

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const body = (await req.json()) as {
      ingest_id?: string;
      selected_product_ids?: string[];
      source_url?: string;
      platform?: string;
      reject_all?: boolean;
    };

    const ingestId = body.ingest_id?.trim();
    if (!ingestId) {
      return new Response(JSON.stringify({ error: 'ingest_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: ingest, error: ingErr } = await admin
      .from('ingest_requests')
      .select('id, user_id, source_url, platform, status, video_title, thumbnail, stash_score')
      .eq('id', ingestId)
      .maybeSingle();

    if (ingErr || !ingest || ingest.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Ingest not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (ingest.status === 'published' || ingest.status === 'rejected') {
      return new Response(JSON.stringify({ ok: true, videoId: null, message: 'Already finalized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const selected = body.selected_product_ids ?? [];
    if (selected.length < 1) {
      return new Response(JSON.stringify({ error: 'Select at least one product to publish' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let resolveResult: Awaited<ReturnType<typeof resolveSelectedDraftProducts>>;
    try {
      resolveResult = await resolveSelectedDraftProducts(admin, ingestId, selected);
    } catch (e) {
      console.error('publish draft load', e);
      return new Response(JSON.stringify({ error: 'Could not load draft products' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { drafts, totalDraftRows } = resolveResult;

    if (!drafts.length) {
      const detail =
        totalDraftRows === 0
          ? 'No products are saved for this ingest in the database. Re-open from Create → Your drafts, or run extraction / manual fetch again.'
          : `This ingest has ${totalDraftRows} saved product(s), but none of the IDs sent from the app matched their external_id. Reload the review screen or reopen the draft.`;
      return new Response(JSON.stringify({ error: 'No matching draft products', detail }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sourceUrl = ingest.source_url as string;
    const platform = (ingest.platform as string) || detectPlatform(sourceUrl);
    const ytId = platform === 'youtube' ? extractYouTubeVideoId(sourceUrl) : null;
    const thumb =
      (ingest.thumbnail as string) ||
      (ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : 'https://picsum.photos/seed/publish/640/1136');
    const embedUrl = transformToEmbedUrl(sourceUrl, platform) ?? sourceUrl;
    const first = drafts[0];
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
      console.error(vErr);
      return new Response(JSON.stringify({ error: 'Failed to create video', detail: vErr?.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const videoId = videoRow.id as string;

    const productInserts = drafts.map((d, i) => ({
      video_id: videoId,
      name: d.name,
      price: d.price,
      image: d.image || 'https://picsum.photos/seed/vp/400/400',
      affiliate_url: d.affiliate_url,
      provider: d.provider,
      sort_order: i,
    }));

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

    return new Response(JSON.stringify({ ok: true, videoId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message ?? 'Server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
