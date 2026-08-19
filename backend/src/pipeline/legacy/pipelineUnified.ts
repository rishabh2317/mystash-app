/**
 * Single multimodal OpenAI call: base64 frames + transcript → shoppable products.
 * Optional Google CSE pass to replace weak URLs. Uses shared OpenAI rate limiting.
 */

import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExtractionPipelineMeta, ExtractionPipelineResult } from './extractionTypes';
import { ingestLog } from './ingestLog';
import type { ExtractedProduct } from './productTypes';
import { fetchYoutubeThumbnailParts, type PipelineCtx } from './pipelineVision';
import { searchProductPurchaseUrl, verifyUrlMatchesProduct } from './productRetrieval';
import type { YoutubeContextPack } from './youtubeContext';
import { createOpenAIClient, defaultOpenAiModel } from './openaiClient';
import { openaiCompletionWithRateLimit } from './openaiRateLimit';

function badMerchantUrl(url: string): boolean {
  const u = url.toLowerCase();
  return !u.startsWith('https://') || u.includes('example.com');
}

type RawProductJson = {
  productName?: string;
  name?: string;
  brand?: string;
  confidence?: number;
  timestamp?: string | number;
  merchantUrl?: string;
  price?: string;
  currency?: string;
  image?: string;
  externalId?: string;
};

function parseProductsObject(text: string): RawProductJson[] | null {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return null;
  }
  if (!root || typeof root !== 'object') return null;
  const products = (root as { products?: unknown }).products;
  if (!Array.isArray(products)) return null;
  return products as RawProductJson[];
}

function mapRawProducts(raw: RawProductJson[]): ExtractedProduct[] {
  const out: ExtractedProduct[] = [];
  for (let i = 0; i < raw.length; i++) {
    const x = raw[i]!;
    const pname = (x.productName ?? x.name ?? '').trim();
    const brand = (x.brand ?? '').trim();
    const name = brand ? `${brand} ${pname}`.trim() : pname;
    const merchantUrl = (x.merchantUrl ?? '').trim();
    if (!name || !merchantUrl) continue;
    const ts = x.timestamp != null ? String(x.timestamp) : undefined;
    out.push({
      externalId: String(x.externalId ?? `u_${i + 1}`),
      name,
      price: String(x.price ?? '—'),
      currency: String(x.currency ?? 'USD'),
      merchantUrl,
      image: x.image ? String(x.image) : undefined,
      confidence: typeof x.confidence === 'number' ? x.confidence : 0.72,
      ...(ts ? { timestamp: ts } : {}),
    });
  }
  return out.length ? out : [];
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

function inlinePartsToOpenAiContent(
  parts: Array<{ inline_data: { mime_type: string; data: string } }>,
  textBlock: string,
): ChatCompletionContentPart[] {
  const content: ChatCompletionContentPart[] = [{ type: 'text', text: textBlock }];
  for (const p of parts) {
    const mime = p.inline_data.mime_type;
    const data = p.inline_data.data;
    const url = `data:${mime};base64,${data}`;
    content.push({
      type: 'image_url',
      image_url: { url, detail: 'low' },
    });
  }
  return content;
}

const SYSTEM_PROMPT = `You are a product extraction engine for a video shopping app.

You receive the video transcript and optional preview frames (images). Respond with a single JSON object only (no markdown).

Schema:
{
  "products": [
    {
      "productName": string,
      "brand": string,
      "confidence": number,
      "timestamp": string,
      "merchantUrl": string,
      "price": string,
      "currency": string,
      "image": string,
      "externalId": string
    }
  ]
}

Rules:
- productName: specific item (e.g. model name); brand: manufacturer or empty string.
- confidence: 0–1 how sure you are this matches video content.
- timestamp: best estimate where it appears in the video (e.g. "0:42" or "1:05").
- merchantUrl must be https on a real retailer product page (not example.com).
- Include 1–6 physical products visible or clearly discussed; empty products array if none.
- Omit unknown optional fields rather than guessing URLs.`;

/**
 * One OpenAI multimodal request (frames + transcript). Retries text-only if frames loaded but request failed.
 */
export async function runUnifiedYoutubeExtraction(
  admin: SupabaseClient,
  pack: YoutubeContextPack,
  ctx: PipelineCtx,
): Promise<ExtractionPipelineResult | { kind: 'failed'; code: string; message: string }> {
  const tAll = performance.now();
  let openaiCalls = 0;

  const transcriptAgent: ExtractionPipelineMeta['transcriptAgent'] =
    pack.transcript.length > 200
      ? 'youtube_captions'
      : pack.transcript.length > 40
        ? 'youtube_captions_partial'
        : 'url_only';

  const userText = `Video title: ${pack.title}
Channel: ${pack.authorName}

Description:
"""
${pack.description.slice(0, 10000)}
"""

Transcript (may be partial):
"""
${pack.transcript.slice(0, 14000)}
"""

Extract purchasable products aligned with frames and transcript.`;

  const client = createOpenAIClient();
  const model = defaultOpenAiModel();

  let imageParts = await fetchYoutubeThumbnailParts(pack.videoId, { ingestId: ctx.ingestId, traceId: ctx.traceId });
  const framesLoadedInitially = imageParts.length;

  const runOnce = async (parts: Array<{ inline_data: { mime_type: string; data: string } }>, note?: string) => {
    openaiCalls++;
    const content = inlinePartsToOpenAiContent(parts, note ? `${userText}\n\n${note}` : userText);

    const completion = await openaiCompletionWithRateLimit(
      admin,
      { ingestId: ctx.ingestId, traceId: ctx.traceId },
      () =>
        client.chat.completions.create({
          model,
          response_format: { type: 'json_object' },
          temperature: 0.28,
          max_tokens: 4096,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content },
          ],
        }),
    );

    const raw = completion.choices[0]?.message?.content?.trim() ?? '';
    return raw;
  };

  let textOut = '';
  try {
    textOut = await runOnce(imageParts);
  } catch (e) {
    ingestLog('warn', 'pipeline.unified.first_attempt_failed', {
      ingestId: ctx.ingestId,
      traceId: ctx.traceId,
      message: (e as Error).message?.slice(0, 200),
    });
    textOut = '';
  }

  if (!textOut && framesLoadedInitially > 0) {
    ingestLog('warn', 'pipeline.unified.retry_text_only', {
      ingestId: ctx.ingestId,
      traceId: ctx.traceId,
    });
    try {
      textOut = await runOnce([], 'No images available—use transcript and title only.');
    } catch {
      textOut = '';
    }
  }

  if (!textOut) {
    return {
      kind: 'failed',
      code: 'UNIFIED_OPENAI_EMPTY',
      message: 'OpenAI returned no content.',
    };
  }

  const rawList = parseProductsObject(textOut);
  if (!rawList) {
    return { kind: 'failed', code: 'UNIFIED_PARSE', message: 'Could not parse OpenAI JSON object.' };
  }

  let products = mapRawProducts(rawList);
  if (products.length === 0) {
    return { kind: 'failed', code: 'UNIFIED_NO_PRODUCTS', message: 'No products in OpenAI response.' };
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
    openaiCalls,
    durationMs,
    framesUsed: framesLoadedInitially > 0 ? framesLoadedInitially : 0,
    cseUsed: enriched.cseUsed,
  });

  const meta: ExtractionPipelineMeta = {
    transcriptAgent,
    contextSources: [
      ...new Set([
        ...pack.sources,
        'unified_multimodal_openai',
        framesLoadedInitially > 0 ? 'vision_thumbnails' : 'text_only_fallback',
        enriched.cseUsed ? 'google_cse' : 'cse_skipped',
        `openai_calls_${openaiCalls}`,
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
    extractionSource: 'openai',
    durationMs,
    extractionStatus: 'ok',
    pipelineMeta: meta,
  };
}
