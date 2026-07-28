import type {
  ExtractionError,
  ExtractionLogContext,
  ExtractionPipelineMeta,
  ExtractionPipelineResult,
} from './extractionTypes.ts';
import { ingestLog } from './ingestLog.ts';
import type { ExtractedProduct } from './productTypes.ts';

export type {
  ExtractionError,
  ExtractionLogContext,
  ExtractionPipelineMeta,
  ExtractionPipelineResult,
} from './extractionTypes.ts';
export type { ExtractedProduct } from './productTypes.ts';

const PIPELINE_META_LEGACY: ExtractionPipelineMeta = {
  transcriptAgent: 'not_implemented',
  contextSources: ['source_url', 'platform', 'video_id_hint'],
  priceAgent: 'llm_only_unverified',
};

function ytThumb(videoId: string | null): string | undefined {
  if (!videoId) return undefined;
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

/** Non-AI rows so the review UI still works; clearly labeled as placeholders. */
export function buildDegradedPlaceholder(
  params: { sourceUrl: string; platform: string; videoId: string | null },
  error: ExtractionError,
): ExtractionPipelineResult {
  return {
    products: placeholderProducts(params),
    extractionSource: 'mock',
    durationMs: 0,
    extractionStatus: 'degraded',
    extractionError: error,
    pipelineMeta: PIPELINE_META_LEGACY,
  };
}

function placeholderProducts(params: {
  sourceUrl: string;
  platform: string;
  videoId: string | null;
}): ExtractedProduct[] {
  const thumb = params.platform === 'youtube' ? ytThumb(params.videoId) : 'https://picsum.photos/seed/ingest/400/400';

  return [
    {
      externalId: 'ph_placeholder_1',
      name: '[Preview only] Placeholder product — not AI-extracted',
      price: '—',
      currency: 'USD',
      merchantUrl: 'https://example.com/mystash-placeholder-1',
      image: thumb,
      confidence: 0,
    },
    {
      externalId: 'ph_placeholder_2',
      name: '[Preview only] Second placeholder — fix extraction to replace',
      price: '—',
      currency: 'USD',
      merchantUrl: 'https://example.com/mystash-placeholder-2',
      image: 'https://picsum.photos/seed/ph2/400/400',
      confidence: 0,
    },
  ];
}

type GeminiTryResult =
  | { kind: 'ok'; products: ExtractedProduct[]; geminiHttpMs: number }
  | { kind: 'no_api_key' }
  | { kind: 'http_error'; status: number; snippet: string; geminiHttpMs: number }
  | { kind: 'empty_body'; geminiHttpMs: number }
  | { kind: 'parse_failed'; geminiHttpMs: number; textLen?: number }
  | { kind: 'filtered_empty'; rawCount: number; geminiHttpMs: number }
  | { kind: 'exception'; message: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** If `Retry-After` is a small integer (seconds), return milliseconds; else undefined. */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const sec = Number.parseInt(header.trim(), 10);
  if (!Number.isFinite(sec) || sec < 1 || sec > 120) return undefined;
  return sec * 1000;
}

function toUserError(kind: Exclude<GeminiTryResult, { kind: 'ok' }>): ExtractionError {
  switch (kind.kind) {
    case 'no_api_key':
      return {
        code: 'GEMINI_NOT_CONFIGURED',
        message:
          'Live AI extraction is off: GEMINI_API_KEY is not set on this Edge deployment. Below are non-real preview rows.',
      };
    case 'http_error':
      if (kind.status === 429) {
        return {
          code: 'GEMINI_RATE_LIMIT',
          message:
            'Google Gemini returned HTTP 429 (too many requests). Short-term quota or requests-per-minute was exceeded — wait 1–2 minutes, avoid double-submits, or raise limits in Google AI Studio / Cloud.',
          detail: kind.snippet.slice(0, 280),
        };
      }
      if (kind.status === 503) {
        return {
          code: 'GEMINI_UNAVAILABLE',
          message:
            'Google Gemini returned HTTP 503 (overloaded or maintenance). Preview placeholders are shown; retry shortly.',
          detail: kind.snippet.slice(0, 280),
        };
      }
      return {
        code: 'GEMINI_HTTP_ERROR',
        message: `The AI provider returned HTTP ${kind.status}. Preview placeholders are shown instead of real matches.`,
        detail: kind.snippet.slice(0, 280),
      };
    case 'empty_body':
      return {
        code: 'GEMINI_EMPTY_RESPONSE',
        message: 'The AI provider returned no text to parse. Preview placeholders are shown.',
        detail: `geminiHttpMs=${kind.geminiHttpMs}`,
      };
    case 'parse_failed':
      return {
        code: 'GEMINI_JSON_PARSE',
        message: 'Could not parse product JSON from the AI response. Preview placeholders are shown.',
        detail: kind.textLen != null ? `responseLength=${kind.textLen}` : undefined,
      };
    case 'filtered_empty':
      return {
        code: 'GEMINI_NO_VALID_PRODUCTS',
        message:
          'The model returned candidates, but none passed validation (name, https merchant URL). Preview placeholders are shown.',
        detail: `rawCount=${kind.rawCount}`,
      };
    case 'exception':
      return {
        code: 'GEMINI_EXCEPTION',
        message: 'An unexpected error occurred while calling the AI. Preview placeholders are shown.',
        detail: kind.message.slice(0, 280),
      };
    default: {
      const _x: never = kind;
      void _x;
      return {
        code: 'EXTRACTION_UNKNOWN',
        message: 'Extraction did not return real products. Preview placeholders are shown.',
      };
    }
  }
}

async function tryGeminiExtract(
  params: {
    sourceUrl: string;
    platform: string;
    videoId: string | null;
    videoTitle?: string;
  },
  ctx: ExtractionLogContext,
): Promise<GeminiTryResult> {
  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiKey) {
    ingestLog('info', 'extract.gemini.skip_no_key', {
      ingestId: ctx.ingestId,
      traceId: ctx.traceId,
      platform: ctx.platform,
      sourceHost: ctx.sourceHost,
    });
    return { kind: 'no_api_key' };
  }

  ingestLog('info', 'extract.gemini.request', {
    ingestId: ctx.ingestId,
    traceId: ctx.traceId,
    platform: ctx.platform,
    sourceHost: ctx.sourceHost,
    hasVideoId: params.videoId != null,
  });

  const prompt = `You are a shopping assistant for a video-commerce app.
Video context:
- Page URL: ${params.sourceUrl}
- Platform: ${params.platform}
- YouTube video id (if any): ${params.videoId ?? 'n/a'}

Return a JSON array (only the array, no markdown) of 1 to 4 physical products a viewer might buy after watching this short/reel.
Each object must have: externalId (short slug), name, price (string like "$29.99"), currency (e.g. USD), merchantUrl (https URL to a real-looking product page — use well-known retailer patterns), image (optional https image URL), confidence (number 0-1).

Be specific to likely categories for this URL (e.g. tech, beauty, fitness) even without watching the video.`;

  const geminiUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
  const requestBody = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
    },
  });

  const t0 = performance.now();
  try {
    const MAX_GEMINI_ATTEMPTS = 4;
    let lastStatus = 0;
    let lastErrText = '';
    let res: Response | undefined;

    for (let attempt = 0; attempt < MAX_GEMINI_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        ingestLog('warn', 'extract.gemini.retry', {
          ingestId: ctx.ingestId,
          traceId: ctx.traceId,
          attempt,
          lastStatus,
        });
      }

      res = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      });

      if (res.ok) {
        break;
      }

      lastStatus = res.status;
      lastErrText = await res.text().catch(() => '');

      ingestLog('warn', 'extract.gemini.http_error_attempt', {
        ingestId: ctx.ingestId,
        traceId: ctx.traceId,
        status: res.status,
        attempt,
        geminiHttpMs: Math.round(performance.now() - t0),
        errSnippet: lastErrText.slice(0, 240),
      });

      const retryable = (res.status === 429 || res.status === 503) && attempt < MAX_GEMINI_ATTEMPTS - 1;
      if (retryable) {
        const headerMs = parseRetryAfterMs(res.headers.get('Retry-After'));
        const backoffMs = headerMs ?? Math.min(12_000, 2000 * 2 ** attempt);
        await sleep(backoffMs);
        continue;
      }

      ingestLog('warn', 'extract.gemini.http_error_final', {
        ingestId: ctx.ingestId,
        traceId: ctx.traceId,
        status: lastStatus,
        geminiHttpMs: Math.round(performance.now() - t0),
        errSnippet: lastErrText.slice(0, 240),
      });
      return {
        kind: 'http_error',
        status: lastStatus,
        snippet: lastErrText,
        geminiHttpMs: Math.round(performance.now() - t0),
      };
    }

    if (!res?.ok) {
      return {
        kind: 'http_error',
        status: lastStatus || 502,
        snippet: lastErrText,
        geminiHttpMs: Math.round(performance.now() - t0),
      };
    }

    const geminiHttpMs = Math.round(performance.now() - t0);

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    if (!text) {
      ingestLog('warn', 'extract.gemini.empty_body', {
        ingestId: ctx.ingestId,
        traceId: ctx.traceId,
        geminiHttpMs,
      });
      return { kind: 'empty_body', geminiHttpMs };
    }

    let arr: Array<{
      externalId?: string;
      name?: string;
      price?: string;
      currency?: string;
      merchantUrl?: string;
      image?: string;
      confidence?: number;
    }>;

    try {
      arr = JSON.parse(text) as typeof arr;
    } catch {
      const start = text.indexOf('[');
      const end = text.lastIndexOf(']');
      if (start < 0 || end <= start) {
        ingestLog('warn', 'extract.gemini.parse_no_array', {
          ingestId: ctx.ingestId,
          traceId: ctx.traceId,
          geminiHttpMs,
          textLen: text.length,
        });
        return { kind: 'parse_failed', geminiHttpMs, textLen: text.length };
      }
      try {
        arr = JSON.parse(text.slice(start, end + 1)) as typeof arr;
      } catch {
        ingestLog('warn', 'extract.gemini.parse_json_fail', {
          ingestId: ctx.ingestId,
          traceId: ctx.traceId,
          geminiHttpMs,
        });
        return { kind: 'parse_failed', geminiHttpMs, textLen: text.length };
      }
    }

    if (!Array.isArray(arr) || arr.length === 0) {
      ingestLog('warn', 'extract.gemini.no_products', {
        ingestId: ctx.ingestId,
        traceId: ctx.traceId,
        geminiHttpMs,
      });
      return { kind: 'parse_failed', geminiHttpMs, textLen: text.length };
    }

    const mapped = arr
      .filter((x) => x.name && x.merchantUrl && String(x.merchantUrl).startsWith('http'))
      .map((x, i) => ({
        externalId: String(x.externalId ?? `g_${i + 1}`),
        name: String(x.name),
        price: String(x.price ?? '$0'),
        currency: String(x.currency ?? 'USD'),
        merchantUrl: String(x.merchantUrl),
        image: x.image ? String(x.image) : undefined,
        confidence: typeof x.confidence === 'number' ? x.confidence : 0.72,
      }));

    if (mapped.length === 0) {
      ingestLog('warn', 'extract.gemini.filtered_empty', {
        ingestId: ctx.ingestId,
        traceId: ctx.traceId,
        rawCount: arr.length,
        geminiHttpMs,
      });
      return { kind: 'filtered_empty', rawCount: arr.length, geminiHttpMs };
    }

    ingestLog('info', 'extract.gemini.ok', {
      ingestId: ctx.ingestId,
      traceId: ctx.traceId,
      productCount: mapped.length,
      geminiHttpMs,
    });

    return { kind: 'ok', products: mapped, geminiHttpMs };
  } catch (e) {
    const msg = (e as Error).message ?? 'unknown';
    ingestLog('error', 'extract.gemini.exception', {
      ingestId: ctx.ingestId,
      traceId: ctx.traceId,
      message: msg.slice(0, 300),
    });
    return { kind: 'exception', message: msg };
  }
}

/**
 * Legacy single-call Gemini extraction (Instagram / sync fallback).
 * YouTube ingests should use the queued unified pipeline in `extractionExecutor.ts`.
 */
export async function extractProductsFromUrl(
  params: {
    sourceUrl: string;
    platform: string;
    videoId: string | null;
    videoTitle?: string;
  },
  ctx: ExtractionLogContext,
): Promise<ExtractionPipelineResult> {
  const tAll = performance.now();
  ingestLog('info', 'extract.start', {
    ingestId: ctx.ingestId,
    traceId: ctx.traceId,
    platform: ctx.platform,
    sourceHost: ctx.sourceHost,
  });

  let gemini: GeminiTryResult;
  try {
    gemini = await tryGeminiExtract(params, ctx);
  } catch (e) {
    const durationMs = Math.round(performance.now() - tAll);
    const err: ExtractionError = {
      code: 'GEMINI_EXCEPTION',
      message: 'Extraction failed before a response could be handled.',
      detail: (e as Error).message?.slice(0, 280),
    };
    ingestLog('error', 'extract.outer_exception', {
      ingestId: ctx.ingestId,
      traceId: ctx.traceId,
      message: err.detail,
    });
    return {
      products: placeholderProducts(params),
      extractionSource: 'mock',
      durationMs,
      extractionStatus: 'degraded',
      extractionError: err,
      pipelineMeta: PIPELINE_META_LEGACY,
    };
  }

  if (gemini.kind === 'ok') {
    const durationMs = Math.round(performance.now() - tAll);
    ingestLog('info', 'extract.complete', {
      ingestId: ctx.ingestId,
      traceId: ctx.traceId,
      source: 'gemini',
      productCount: gemini.products.length,
      durationMs,
    });
    return {
      products: gemini.products,
      extractionSource: 'gemini',
      durationMs,
      extractionStatus: 'ok',
      pipelineMeta: PIPELINE_META_LEGACY,
    };
  }

  const durationMs = Math.round(performance.now() - tAll);
  const extractionError = toUserError(gemini as Exclude<GeminiTryResult, { kind: 'ok' }>);
  ingestLog('info', 'extract.degraded_placeholder', {
    ingestId: ctx.ingestId,
    traceId: ctx.traceId,
    reasonCode: extractionError.code,
    durationMs,
  });

  return {
    products: placeholderProducts(params),
    extractionSource: 'mock',
    durationMs,
    extractionStatus: 'degraded',
    extractionError,
    pipelineMeta: PIPELINE_META_LEGACY,
  };
}
