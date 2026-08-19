/**
 * Single multimodal Gemini call: thumbnails + transcript → shoppable products.
 * Optional Google CSE pass to replace weak URLs. Uses shared Gemini rate limiting.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import type { ExtractionPipelineMeta, ExtractionPipelineResult } from './extractionTypes.ts';
import { geminiGenerateContentWithRateLimit } from './geminiRateLimit.ts';
import { ingestLog } from './ingestLog.ts';
import type { ExtractedProduct } from './productTypes.ts';
import { fetchYoutubeThumbnailParts, type PipelineCtx } from './pipelineVision.ts';
import { searchProductPurchaseUrl, verifyUrlMatchesProduct } from './productRetrieval.ts';
import type { YoutubeContextPack } from './youtubeContext.ts';

const GEMINI_MODEL =
  Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.0-flash';

function badMerchantUrl(url: string): boolean {
  const u = url.toLowerCase();
  return !u.startsWith('https://') || u.includes('example.com');
}

async function parseProductArray(text: string): ExtractedProduct[] | null {
  let arr: unknown;
  try {
    arr = JSON.parse(text);
  } catch {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end <= start) return null;
    try {
      arr = JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr)) return null;

  const mapped: ExtractedProduct[] = [];
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i] as Record<string, unknown>;
    const name = x?.name != null ? String(x.name).trim() : '';
    const merchantUrl = x?.merchantUrl != null ? String(x.merchantUrl).trim() : '';
    if (!name || !merchantUrl) continue;
    mapped.push({
      externalId: String(x.externalId ?? `u_${i + 1}`),
      name,
      price: String(x.price ?? '—'),
      currency: String(x.currency ?? 'USD'),
      merchantUrl,
      image: x.image ? String(x.image) : undefined,
      confidence: typeof x.confidence === 'number' ? x.confidence : 0.72,
    });
  }
  return mapped.length ? mapped : null;
}

async function enrichWithCse(
  products: ExtractedProduct[],
  ctx: PipelineCtx,
): Promise<{ products: ExtractedProduct[]; cseUsed: boolean }> {
  let cseUsed = false;
  const out: ExtractedProduct[] = [];

  for (const p of products) {
    const weak =
      badMerchantUrl(p.merchantUrl) ||
      p.confidence < 0.42 ||
      p.merchantUrl.length < 16;

    if (!weak) {
      out.push(p);
      continue;
    }

    const hit = await searchProductPurchaseUrl(p.name, { ingestId: ctx.ingestId, traceId: ctx.traceId });
    if (hit && verifyUrlMatchesProduct(p.name, hit.title, hit.url)) {
      cseUsed = true;
      out.push({
        ...p,
        merchantUrl: hit.url,
        confidence: Math.min(0.92, Math.max(p.confidence, 0.55)),
      });
    } else if (!badMerchantUrl(p.merchantUrl)) {
      out.push(p);
    } else if (hit) {
      cseUsed = true;
      out.push({
        ...p,
        merchantUrl: hit.url,
        confidence: Math.min(0.85, Math.max(p.confidence, 0.48)),
      });
    } else {
      out.push(p);
    }
  }

  return { products: out, cseUsed };
}

/**
 * One Gemini multimodal request (frames + text). Optionally second attempt text-only if zero frames.
 */
export async function runUnifiedYoutubeExtraction(
  admin: SupabaseClient,
  pack: YoutubeContextPack,
  geminiKey: string,
  ctx: PipelineCtx,
): Promise<ExtractionPipelineResult | { kind: 'failed'; code: string; message: string }> {
  const tAll = performance.now();
  let geminiCalls = 0;

  const transcriptAgent: ExtractionPipelineMeta['transcriptAgent'] =
    pack.transcript.length > 200
      ? 'youtube_captions'
      : pack.transcript.length > 40
        ? 'youtube_captions_partial'
        : 'url_only';

  const textPrompt = `You are the unified extractor for a video-commerce app. You see still preview frames from a YouTube video and transcript/title context.

Video title: ${pack.title}
Channel: ${pack.authorName}

Description:
"""
${pack.description.slice(0, 10000)}
"""

Transcript (may be partial):
"""
${pack.transcript.slice(0, 14000)}
"""

Task: Return **only** a JSON array (no markdown) of 1 to 6 physical products viewers could buy that match what is **visible in the frames** and/or clearly discussed in the transcript.

Each object MUST have:
{
  "externalId": string (short slug),
  "name": string,
  "price": string (estimate if unknown, e.g. "$79"),
  "currency": string (e.g. USD),
  "merchantUrl": string (https link to a **real** major retailer product/detail page — NOT example.com),
  "image": string optional https product image,
  "confidence": number 0-1
}

Rules:
- Prefer accurate brand + model when visible or spoken.
- merchantUrl must be https on a plausible retailer domain.
- Skip scenery-only shots with no product.
If nothing is identifiable return [].`;

  ingestLog('info', 'reasoning.context.ready', {
    ingestId: ctx.ingestId,
    traceId: ctx.traceId,
    stage: 1,
    titleLength: pack.title.length,
    descriptionLength: pack.description.length,
    descriptionSource: pack.descriptionSource,
    descriptionAvailable: pack.description.length > 0,
    descriptionPassedToReasoning: true,
    transcriptLength: pack.transcript.length,
    creatorPresent: pack.authorName.length > 0,
    thumbnailPresent: Boolean(pack.thumbnailUrl),
  });

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiKey}`;

  let imageParts = await fetchYoutubeThumbnailParts(pack.videoId, { ingestId: ctx.ingestId, traceId: ctx.traceId });
  const framesLoadedInitially = imageParts.length;

  const runRequest = async (
    parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }>,
  ) => {
    geminiCalls++;
    const body = JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.28,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
    });
    return geminiGenerateContentWithRateLimit(admin, url, body, {
      ingestId: ctx.ingestId,
      traceId: ctx.traceId,
    });
  };

  let parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [...imageParts, { text: textPrompt }];
  let gen = await runRequest(parts);

  if (!gen.ok && framesLoadedInitially > 0) {
    ingestLog('warn', 'pipeline.unified.retry_text_only', {
      ingestId: ctx.ingestId,
      traceId: ctx.traceId,
    });
    imageParts = [];
    parts = [{ text: textPrompt + '\n\nNote: No images available—use transcript and title only.' }];
    gen = await runRequest(parts);
  }

  if (!gen.ok) {
    const status = gen.response?.status ?? 0;
    const snippet = gen.response ? await gen.response.text().catch(() => '') : '';
    return {
      kind: 'failed',
      code: 'UNIFIED_GEMINI_HTTP',
      message: `Unified extraction HTTP ${status}`.slice(0, 200),
    };
  }

  const json = (await gen.response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';

  if (!text) {
    return { kind: 'failed', code: 'UNIFIED_EMPTY', message: 'Gemini returned no JSON text.' };
  }

  let products = await parseProductArray(text);
  if (!products || products.length === 0) {
    return { kind: 'failed', code: 'UNIFIED_NO_PRODUCTS', message: 'No parseable products from unified model.' };
  }

  products = products
    .filter((p) => !badMerchantUrl(p.merchantUrl) || p.name.length > 2)
    .filter((p) => !String(p.merchantUrl).includes('example.com'));

  const enriched = await enrichWithCse(products, ctx);
  products = enriched.products.filter((p) => !badMerchantUrl(p.merchantUrl));

  if (products.length === 0) {
    return { kind: 'failed', code: 'UNIFIED_FILTERED', message: 'No valid https merchant URLs after CSE enrichment.' };
  }

  const durationMs = Math.round(performance.now() - tAll);
  ingestLog('info', 'pipeline.unified.ok', {
    ingestId: ctx.ingestId,
    traceId: ctx.traceId,
    productCount: products.length,
    geminiCalls,
    durationMs,
    framesUsed: framesLoadedInitially > 0 ? framesLoadedInitially : 0,
    cseUsed: enriched.cseUsed,
  });

  const meta: ExtractionPipelineMeta = {
    transcriptAgent,
    contextSources: [
      ...new Set([
        ...pack.sources,
        'unified_multimodal',
        framesLoadedInitially > 0 ? 'vision_thumbnails' : 'text_only_fallback',
        enriched.cseUsed ? 'google_cse' : 'cse_skipped',
        `gemini_calls_${geminiCalls}`,
      ]),
    ],
    priceAgent: 'matcher_llm',
    agenticPipeline: true,
    stagesCompleted: [
      's1_context',
      framesLoadedInitially > 0 ? 's2_unified_frames' : 's2_unified_text',
      's3_retrieval_enrich',
    ],
  };

  return {
    products,
    extractionSource: 'gemini',
    durationMs,
    extractionStatus: 'ok',
    pipelineMeta: meta,
  };
}
