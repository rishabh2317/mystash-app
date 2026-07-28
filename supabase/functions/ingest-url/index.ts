import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { detectPlatform, extractYouTubeVideoId } from '../_shared/detect.ts';
import { ingestLog } from '../_shared/ingestLog.ts';

/** @deprecated The Expo app uses the Node backend `POST /ingest` instead. Kept for legacy or non-app callers. */

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Fire-and-forget worker wake (cron may also invoke `process-extraction-queue`). */
function kickExtractionQueue(supabaseUrl: string, serviceKey: string): void {
  const url = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/process-extraction-queue`;
  fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ limit: 3 }),
  }).catch(() => {
    ingestLog('warn', 'ingest.queue_kick_failed', {});
  });
}

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

    const httpTraceId = crypto.randomUUID();
    const admin = createClient(supabaseUrl, serviceKey);

    const body = (await req.json()) as { source_url?: string };
    const sourceUrl = (body.source_url ?? '').trim();
    if (!sourceUrl) {
      return new Response(JSON.stringify({ error: 'source_url required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let parsed: URL;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const platform = detectPlatform(parsed.href);
    if (platform === 'unknown') {
      ingestLog('warn', 'ingest.unsupported_platform', { httpTraceId, sourceHost: parsed.hostname });
      return new Response(JSON.stringify({ error: 'Only YouTube and Instagram URLs are supported' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    ingestLog('info', 'ingest.accepted', {
      httpTraceId,
      userId: user.id,
      platform,
      sourceHost: parsed.hostname,
    });

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await admin
      .from('ingest_requests')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('source_url', sourceUrl)
      .in('status', ['draft', 'processing', 'ready_for_review'])
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      ingestLog('info', 'ingest.duplicate_reuse', {
        httpTraceId,
        ingestId: existing.id,
        userId: user.id,
        status: existing.status ?? 'unknown',
      });

      const { data: extMeta } = await admin
        .from('ingest_extractions')
        .select('payload')
        .eq('ingest_request_id', existing.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const extPayload = extMeta?.payload as Record<string, unknown> | undefined;
      const extractionSource =
        typeof extPayload?.extractionSource === 'string' ? extPayload.extractionSource : 'unknown';
      const extractionDurationMs =
        typeof extPayload?.durationMs === 'number' ? extPayload.durationMs : undefined;
      const priorTraceId = typeof extPayload?.traceId === 'string' ? extPayload.traceId : undefined;
      const extractionStatus =
        extPayload?.extractionStatus === 'ok' || extPayload?.extractionStatus === 'degraded'
          ? extPayload.extractionStatus
          : extractionSource === 'gemini'
            ? 'ok'
            : 'degraded';
      const extractionError =
        extPayload?.extractionError &&
        typeof extPayload.extractionError === 'object' &&
        extPayload.extractionError !== null &&
        'code' in extPayload.extractionError &&
        'message' in extPayload.extractionError
          ? (extPayload.extractionError as { code: string; message: string; detail?: string })
          : undefined;
      const pipelineMeta =
        extPayload?.pipelineMeta && typeof extPayload.pipelineMeta === 'object'
          ? extPayload.pipelineMeta
          : undefined;

      const { data: rows } = await admin
        .from('ingest_draft_products')
        .select('external_id, name, price, currency, image, affiliate_url, provider, confidence')
        .eq('ingest_request_id', existing.id);

      const products = (rows ?? []).map((r) => ({
        id: r.external_id,
        name: r.name,
        price: r.price,
        currency: r.currency ?? undefined,
        provider: r.provider ?? 'unknown',
        affiliateUrl: r.affiliate_url,
        image: r.image ?? undefined,
        confidence: r.confidence ?? undefined,
      }));

      const { data: ir } = await admin
        .from('ingest_requests')
        .select('source_url, platform, video_title, thumbnail, stash_score, status')
        .eq('id', existing.id)
        .single();

      const rowStatus = ir?.status ?? 'draft';
      const extractionPending = rowStatus === 'processing' && products.length === 0;

      ingestLog('info', 'ingest.duplicate_response', {
        httpTraceId,
        ingestId: existing.id,
        extractionSource,
        extractionStatus,
        productCount: products.length,
        priorTraceId: priorTraceId ?? null,
        extractionPending,
      });

      kickExtractionQueue(supabaseUrl, serviceKey);

      return new Response(
        JSON.stringify({
          ingestId: existing.id,
          sourceUrl: ir?.source_url ?? sourceUrl,
          platform: ir?.platform ?? platform,
          videoTitle: ir?.video_title ?? undefined,
          thumbnail: ir?.thumbnail ?? undefined,
          stashScore: ir?.stash_score ?? 4.5,
          products,
          status:
            rowStatus === 'processing'
              ? 'processing'
              : rowStatus === 'ready_for_review'
                ? 'ready_for_review'
                : 'draft',
          extractionPending,
          extractionSource,
          extractionDurationMs,
          traceId: priorTraceId ?? httpTraceId,
          extractionStatus,
          extractionError: extractionError ?? null,
          pipelineMeta: pipelineMeta ?? null,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const ytId = platform === 'youtube' ? extractYouTubeVideoId(sourceUrl) : null;
    const thumbnail =
      platform === 'youtube' && ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : null;
    const videoTitle = platform === 'youtube' ? 'YouTube Short' : 'Instagram Reel';

    const { data: ingestRow, error: insErr } = await admin
      .from('ingest_requests')
      .insert({
        user_id: user.id,
        source_url: sourceUrl,
        platform,
        status: 'processing',
        stash_score: 4.5,
        video_title: videoTitle,
        thumbnail,
      })
      .select('id')
      .single();

    if (insErr || !ingestRow) {
      console.error(insErr);
      return new Response(JSON.stringify({ error: 'Could not create ingest request', detail: insErr?.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ingestId = ingestRow.id as string;

    ingestLog('info', 'ingest.created_row', {
      httpTraceId,
      ingestId,
      userId: user.id,
      platform,
      sourceHost: parsed.hostname,
    });

    const { error: jobErr } = await admin.from('extraction_jobs').insert({
      ingest_request_id: ingestId,
      status: 'pending',
      payload: { trace_id: httpTraceId },
    });

    if (jobErr) {
      ingestLog('error', 'ingest.job_enqueue_failed', { ingestId, detail: jobErr.message });
      await admin.from('ingest_requests').delete().eq('id', ingestId);
      return new Response(JSON.stringify({ error: 'Could not enqueue extraction job', detail: jobErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    kickExtractionQueue(supabaseUrl, serviceKey);

    ingestLog('info', 'ingest.enqueued', {
      httpTraceId,
      ingestId,
      platform,
    });

    return new Response(
      JSON.stringify({
        ingestId,
        sourceUrl,
        platform,
        videoTitle,
        thumbnail: thumbnail ?? undefined,
        stashScore: 4.5,
        products: [],
        status: 'processing',
        extractionPending: true,
        extractionSource: 'queued',
        extractionDurationMs: 0,
        traceId: httpTraceId,
        extractionStatus: undefined,
        extractionError: null,
        pipelineMeta: null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    ingestLog('error', 'ingest.unhandled', {
      message: (e as Error).message?.slice(0, 400) ?? 'unknown',
    });
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message ?? 'Server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
