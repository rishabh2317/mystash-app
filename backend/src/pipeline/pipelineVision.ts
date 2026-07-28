/**
 * Stage 2 — Vision Agent ("Eyes")
 * Sends 3–5 key visual frames (thumbnail variants) + transcript to Gemini multimodal.
 */

import { ingestLog } from './ingestLog';
import type { YoutubeContextPack } from './youtubeContext';

/** Shared with `extraction.ts` orchestrator (same fields as `ExtractionLogContext`). */
export type PipelineCtx = {
  ingestId: string;
  traceId: string;
  platform: string;
  sourceHost: string;
};

export type VisionVisibleProduct = {
  name: string;
  visualEvidence: string;
};

export type VisionAgentResult =
  | { ok: true; products: VisionVisibleProduct[]; geminiHttpMs: number }
  | { ok: false; code: string; message: string; detail?: string; geminiHttpMs?: number };

const VISION_FRAME_URLS = (videoId: string) =>
  [
    `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/sddefault.jpg`,
  ] as const;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** YouTube thumbnail ladder → base64 parts for Gemini multimodal (exported for unified pipeline). */
export async function fetchYoutubeThumbnailParts(
  videoId: string,
  logCtx: Pick<PipelineCtx, 'ingestId' | 'traceId'>,
): Promise<Array<{ inline_data: { mime_type: string; data: string } }>> {
  const parts: Array<{ inline_data: { mime_type: string; data: string } }> = [];
  for (const url of VISION_FRAME_URLS(videoId)) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength < 500 || buf.byteLength > 4_000_000) continue;
      const mime = res.headers.get('content-type')?.includes('png') ? 'image/png' : 'image/jpeg';
      let binary = '';
      for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]!);
      const b64 = btoa(binary);
      parts.push({ inline_data: { mime_type: mime, data: b64 } });
    } catch {
      ingestLog('warn', 'pipeline.s2.frame_skip', { ...logCtx, url: String(url).slice(0, 80) });
    }
  }
  return parts;
}

export async function runVisionAgent(
  pack: YoutubeContextPack,
  geminiKey: string,
  ctx: PipelineCtx,
): Promise<VisionAgentResult> {
  ingestLog('info', 'pipeline.s2.vision.start', {
    ingestId: ctx.ingestId,
    traceId: ctx.traceId,
    videoId: pack.videoId,
    transcriptLen: pack.transcript.length,
  });

  const imageParts = await fetchYoutubeThumbnailParts(pack.videoId, { ingestId: ctx.ingestId, traceId: ctx.traceId });
  if (imageParts.length < 1) {
    return {
      ok: false,
      code: 'VISION_NO_FRAMES',
      message: 'Could not load any thumbnail frames for multimodal analysis.',
    };
  }

  const textPrompt = `You are the vision analyst for a shopping app.

Video title: ${pack.title}
Channel: ${pack.authorName}

Transcript (may be partial or empty):
"""
${pack.transcript.slice(0, 12000)}
"""

The user attached ${imageParts.length} still images from the video (thumbnail / preview frames).

Task: Identify **specific physical products** that are clearly suggested by what is visible in the images and/or said in the transcript (e.g. a laptop model, skincare bottle, dumbbell brand if readable).

Return **only** a JSON array (no markdown) of 1 to 6 objects, each:
{ "name": string, "visualEvidence": string }

Rules:
- "name" = short human label (e.g. "Sony WH-1000XM5 headphones").
- "visualEvidence" = one sentence: what you saw or heard that supports it.
- Skip generic scenery with no shoppable product.
- If nothing is identifiable, return [].

Do not include prices or merchant URLs in this stage.`;

  const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [
    ...imageParts,
    { text: textPrompt },
  ];

  const t0 = performance.now();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: 2048,
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
      code: 'VISION_GEMINI_HTTP',
      message: `Vision stage HTTP ${res.status}`,
      detail: snippet.slice(0, 280),
      geminiHttpMs,
    };
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
  if (!raw) {
    return { ok: false, code: 'VISION_EMPTY', message: 'Vision model returned no text.', geminiHttpMs };
  }

  let arr: VisionVisibleProduct[];
  try {
    arr = JSON.parse(raw) as VisionVisibleProduct[];
  } catch {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start < 0 || end <= start) {
      return { ok: false, code: 'VISION_PARSE', message: 'Could not parse vision JSON.', geminiHttpMs };
    }
    try {
      arr = JSON.parse(raw.slice(start, end + 1)) as VisionVisibleProduct[];
    } catch {
      return { ok: false, code: 'VISION_PARSE', message: 'Could not parse vision JSON array.', geminiHttpMs };
    }
  }

  if (!Array.isArray(arr)) {
    return { ok: false, code: 'VISION_PARSE', message: 'Vision JSON was not an array.', geminiHttpMs };
  }

  const cleaned = arr
    .filter((x) => x && typeof x.name === 'string' && x.name.trim().length > 1)
    .map((x) => ({
      name: String(x.name).trim(),
      visualEvidence: typeof x.visualEvidence === 'string' ? x.visualEvidence.trim() : '',
    }))
    .slice(0, 8);

  if (cleaned.length === 0) {
    return { ok: false, code: 'VISION_NO_PRODUCTS', message: 'Vision model found no visible products.', geminiHttpMs };
  }

  ingestLog('info', 'pipeline.s2.vision.ok', {
    ingestId: ctx.ingestId,
    traceId: ctx.traceId,
    count: cleaned.length,
    framesUsed: imageParts.length,
    geminiHttpMs,
  });

  return { ok: true, products: cleaned, geminiHttpMs };
}
