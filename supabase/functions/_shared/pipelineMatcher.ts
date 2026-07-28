/**
 * Stage 3 — Matcher & Wrapper prep ("Closer")
 * Text-only Gemini: turn transcript + vision-visible products into shoppable rows with https merchant URLs.
 * Affiliate wrapping stays in `ingest-url` after this returns `ExtractedProduct[]`.
 */

import { ingestLog } from './ingestLog.ts';
import type { ExtractedProduct } from './productTypes.ts';
import type { PipelineCtx } from './pipelineVision.ts';
import type { VisionVisibleProduct } from './pipelineVision.ts';
import type { YoutubeContextPack } from './youtubeContext.ts';

export type MatcherAgentResult =
  | { ok: true; products: ExtractedProduct[]; geminiHttpMs: number }
  | { ok: false; code: string; message: string; detail?: string; geminiHttpMs?: number };

export async function runMatcherAgent(
  pack: YoutubeContextPack,
  visible: VisionVisibleProduct[],
  geminiKey: string,
  ctx: PipelineCtx,
): Promise<MatcherAgentResult> {
  ingestLog('info', 'pipeline.s3.matcher.start', {
    ingestId: ctx.ingestId,
    traceId: ctx.traceId,
    visibleCount: visible.length,
  });

  const visibleJson = JSON.stringify(visible);

  const visionBlock =
    visible.length > 0
      ? `Vision stage identified these on-screen / mentioned products (JSON):\n${visibleJson}`
      : `Vision stage did not return structured visible products (empty array). Rely primarily on the transcript and title.`;

  const prompt = `You are the merchant matcher for a video-commerce app.

Video title: ${pack.title}
Channel: ${pack.authorName}

Transcript (may be partial):
"""
${pack.transcript.slice(0, 10000)}
"""

${visionBlock}

Task: Produce 1 to 6 **shoppable** products a user could buy, aligned with the vision list (if any) and transcript.

Return **only** a JSON array (no markdown). Each object:
{
  "externalId": string (short slug, unique),
  "name": string,
  "price": string (e.g. "$29.99" — estimate if unknown),
  "currency": string (e.g. USD),
  "merchantUrl": string (must be https URL to a plausible real retailer PDP, not example.com),
  "image": string (optional https product image),
  "confidence": number 0-1
}

Rules:
- Prefer well-known retailer domains when possible.
- Do not use example.com or placeholder hosts.
- If you are unsure of an exact URL, still pick the best **real** retailer search PDP you can justify from the product name (e.g. major electronics or beauty retailers).`;

  const t0 = performance.now();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 3072,
          responseMimeType: 'application/json',
        },
      }),
    },
  );
  const geminiHttpMs = Math.round(performance.now() - t0);

  if (!res.ok) {
    const snippet = await res.text().catch(() => '');
    return {
      ok: false,
      code: 'MATCHER_GEMINI_HTTP',
      message: `Matcher stage HTTP ${res.status}`,
      detail: snippet.slice(0, 280),
      geminiHttpMs,
    };
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
  if (!text) {
    return { ok: false, code: 'MATCHER_EMPTY', message: 'Matcher returned no text.', geminiHttpMs };
  }

  type Row = {
    externalId?: string;
    name?: string;
    price?: string;
    currency?: string;
    merchantUrl?: string;
    image?: string;
    confidence?: number;
  };

  let arr: Row[];
  try {
    arr = JSON.parse(text) as Row[];
  } catch {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end <= start) {
      return { ok: false, code: 'MATCHER_PARSE', message: 'Matcher JSON parse failed.', geminiHttpMs };
    }
    try {
      arr = JSON.parse(text.slice(start, end + 1)) as Row[];
    } catch {
      return { ok: false, code: 'MATCHER_PARSE', message: 'Matcher JSON parse failed.', geminiHttpMs };
    }
  }

  if (!Array.isArray(arr) || arr.length === 0) {
    return { ok: false, code: 'MATCHER_NO_ARRAY', message: 'Matcher did not return a product array.', geminiHttpMs };
  }

  const mapped = arr
    .filter((x) => x.name && x.merchantUrl && String(x.merchantUrl).startsWith('https://'))
    .filter((x) => !String(x.merchantUrl).includes('example.com'))
    .map((x, i) => ({
      externalId: String(x.externalId ?? `m_${i + 1}`),
      name: String(x.name),
      price: String(x.price ?? '$0'),
      currency: String(x.currency ?? 'USD'),
      merchantUrl: String(x.merchantUrl),
      image: x.image ? String(x.image) : undefined,
      confidence: typeof x.confidence === 'number' ? x.confidence : 0.7,
    }));

  if (mapped.length === 0) {
    return {
      ok: false,
      code: 'MATCHER_FILTERED',
      message: 'Matcher output had no valid https merchant URLs.',
      geminiHttpMs,
    };
  }

  ingestLog('info', 'pipeline.s3.matcher.ok', {
    ingestId: ctx.ingestId,
    traceId: ctx.traceId,
    productCount: mapped.length,
    geminiHttpMs,
  });

  return { ok: true, products: mapped, geminiHttpMs };
}
