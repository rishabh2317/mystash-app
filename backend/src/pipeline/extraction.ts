import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ExtractionError,
  ExtractionLogContext,
  ExtractionPipelineMeta,
  ExtractionPipelineResult,
} from './extractionTypes';
import { ingestLog } from './ingestLog';
import type { ExtractedProduct } from './productTypes';
import { createOpenAIClient, defaultOpenAiModel } from './openaiClient';
import { openaiCompletionWithRateLimit } from './openaiRateLimit';
import { getEnv } from '../env';

export type {
  ExtractionError,
  ExtractionLogContext,
  ExtractionPipelineMeta,
  ExtractionPipelineResult,
} from './extractionTypes';
export type { ExtractedProduct } from './productTypes';

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

function httpStatusFromError(e: unknown): number | undefined {
  if (e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number') {
    return (e as { status: number }).status;
  }
  return undefined;
}

function toUserError(kind: Exclude<GeminiTryResult, { kind: 'ok' }>): ExtractionError {
  switch (kind.kind) {
    case 'no_api_key':
      return {
        code: 'OPENAI_NOT_CONFIGURED',
        message:
          'Live AI extraction is off: OPENAI_API_KEY is not set. Below are non-real preview rows.',
      };
    case 'http_error':
      if (kind.status === 429) {
        return {
          code: 'OPENAI_RATE_LIMIT',
          message:
            'OpenAI returned HTTP 429 (rate limit). Wait briefly and retry, or raise limits in OpenAI billing.',
          detail: kind.snippet.slice(0, 280),
        };
      }
      if (kind.status === 503) {
        return {
          code: 'OPENAI_UNAVAILABLE',
          message:
            'OpenAI returned HTTP 503 (overloaded). Preview placeholders are shown; retry shortly.',
          detail: kind.snippet.slice(0, 280),
        };
      }
      return {
        code: 'OPENAI_HTTP_ERROR',
        message: `The AI provider returned HTTP ${kind.status}. Preview placeholders are shown instead of real matches.`,
        detail: kind.snippet.slice(0, 280),
      };
    case 'empty_body':
      return {
        code: 'OPENAI_EMPTY_RESPONSE',
        message: 'The AI provider returned no text to parse. Preview placeholders are shown.',
        detail: `httpMs=${kind.geminiHttpMs}`,
      };
    case 'parse_failed':
      return {
        code: 'OPENAI_JSON_PARSE',
        message: 'Could not parse product JSON from the AI response. Preview placeholders are shown.',
        detail: kind.textLen != null ? `responseLength=${kind.textLen}` : undefined,
      };
    case 'filtered_empty':
      return {
        code: 'OPENAI_NO_VALID_PRODUCTS',
        message:
          'The model returned candidates, but none passed validation (name, https merchant URL). Preview placeholders are shown.',
        detail: `rawCount=${kind.rawCount}`,
      };
    case 'exception':
      return {
        code: 'OPENAI_EXCEPTION',
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

async function tryOpenAiExtract(
  params: {
    sourceUrl: string;
    platform: string;
    videoId: string | null;
    videoTitle?: string;
  },
  ctx: ExtractionLogContext,
  admin?: SupabaseClient,
): Promise<GeminiTryResult> {
  if (!getEnv('OPENAI_API_KEY')) {
    ingestLog('info', 'extract.openai.skip_no_key', {
      ingestId: ctx.ingestId,
      traceId: ctx.traceId,
      platform: ctx.platform,
      sourceHost: ctx.sourceHost,
    });
    return { kind: 'no_api_key' };
  }

  ingestLog('info', 'extract.openai.request', {
    ingestId: ctx.ingestId,
    traceId: ctx.traceId,
    platform: ctx.platform,
    sourceHost: ctx.sourceHost,
    hasVideoId: params.videoId != null,
  });

  const client = createOpenAIClient();
  const model = defaultOpenAiModel();

  const userPrompt = `You are a shopping assistant for a video-commerce app.
Video context:
- Page URL: ${params.sourceUrl}
- Platform: ${params.platform}
- YouTube video id (if any): ${params.videoId ?? 'n/a'}

Return a JSON object only with key "products": array of 1 to 4 physical products a viewer might buy after watching this short/reel.
Each item MUST include: productName (string), brand (string), confidence (number 0-1), timestamp (string, estimated cue in the video e.g. "0:42"), merchantUrl (https product page on a real retailer), price (string), currency (string), externalId (short slug), image (optional https).

Combine brand + productName mentally so merchant URLs match the specific item.`;

  const systemPrompt = `You output only valid JSON: an object with a single property "products" whose value is an array of product objects. Each object uses the field names requested in the user message.`;

  const runCreate = () =>
    client.chat.completions.create({
      model,
      response_format: { type: 'json_object' },
      temperature: 0.35,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

  const t0 = performance.now();

  try {
    let completion: Awaited<ReturnType<typeof runCreate>>;
    if (admin) {
      completion = await openaiCompletionWithRateLimit(
        admin,
        { ingestId: ctx.ingestId, traceId: ctx.traceId },
        runCreate,
      );
    } else {
      const MAX = 4;
      let lastErr: unknown;
      let inner: Awaited<ReturnType<typeof runCreate>> | undefined;
      for (let attempt = 0; attempt < MAX; attempt++) {
        try {
          inner = await runCreate();
          break;
        } catch (e) {
          lastErr = e;
          const st = httpStatusFromError(e);
          if ((st === 429 || st === 503) && attempt < MAX - 1) {
            await sleep(Math.min(12_000, 2000 * 2 ** attempt));
            continue;
          }
          throw e;
        }
      }
      if (!inner) {
        throw lastErr ?? new Error('OpenAI request failed');
      }
      completion = inner;
    }

    const httpMs = Math.round(performance.now() - t0);
    const text = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!text) {
      ingestLog('warn', 'extract.openai.empty_body', {
        ingestId: ctx.ingestId,
        traceId: ctx.traceId,
        httpMs,
      });
      return { kind: 'empty_body', geminiHttpMs: httpMs };
    }

    let root: unknown;
    try {
      root = JSON.parse(text);
    } catch {
      ingestLog('warn', 'extract.openai.parse_root', {
        ingestId: ctx.ingestId,
        traceId: ctx.traceId,
        httpMs,
        textLen: text.length,
      });
      return { kind: 'parse_failed', geminiHttpMs: httpMs, textLen: text.length };
    }

    const arr = (root as { products?: unknown }).products;
    if (!Array.isArray(arr) || arr.length === 0) {
      return { kind: 'parse_failed', geminiHttpMs: httpMs, textLen: text.length };
    }

    const mapped: ExtractedProduct[] = [];
    for (let i = 0; i < arr.length; i++) {
      const x = arr[i] as Record<string, unknown>;
      const pname = String(x.productName ?? x.name ?? '').trim();
      const brand = String(x.brand ?? '').trim();
      const name = brand ? `${brand} ${pname}`.trim() : pname;
      const merchantUrl = String(x.merchantUrl ?? '').trim();
      if (!name || !merchantUrl.startsWith('http')) continue;
      const ts = x.timestamp != null ? String(x.timestamp) : undefined;
      mapped.push({
        externalId: String(x.externalId ?? `g_${i + 1}`),
        name,
        price: String(x.price ?? '$0'),
        currency: String(x.currency ?? 'USD'),
        merchantUrl,
        image: x.image ? String(x.image) : undefined,
        confidence: typeof x.confidence === 'number' ? x.confidence : 0.72,
        ...(ts ? { timestamp: ts } : {}),
      });
    }

    if (mapped.length === 0) {
      ingestLog('warn', 'extract.openai.filtered_empty', {
        ingestId: ctx.ingestId,
        traceId: ctx.traceId,
        rawCount: arr.length,
        httpMs,
      });
      return { kind: 'filtered_empty', rawCount: arr.length, geminiHttpMs: httpMs };
    }

    ingestLog('info', 'extract.openai.ok', {
      ingestId: ctx.ingestId,
      traceId: ctx.traceId,
      productCount: mapped.length,
      httpMs,
    });

    return { kind: 'ok', products: mapped, geminiHttpMs: httpMs };
  } catch (e: unknown) {
    const httpMs = Math.round(performance.now() - t0);
    const st = httpStatusFromError(e);
    const snippet = e instanceof Error ? e.message : String(e);
    if (typeof st === 'number') {
      ingestLog('warn', 'extract.openai.http_error', {
        ingestId: ctx.ingestId,
        traceId: ctx.traceId,
        status: st,
        httpMs,
        errSnippet: snippet.slice(0, 240),
      });
      return {
        kind: 'http_error',
        status: st,
        snippet,
        geminiHttpMs: httpMs,
      };
    }
    const msg = snippet.slice(0, 300);
    ingestLog('error', 'extract.openai.exception', {
      ingestId: ctx.ingestId,
      traceId: ctx.traceId,
      message: msg,
    });
    return { kind: 'exception', message: msg };
  }
}

/**
 * Legacy single-call OpenAI extraction (Instagram / sync fallback).
 */
export async function extractProductsFromUrl(
  params: {
    sourceUrl: string;
    platform: string;
    videoId: string | null;
    videoTitle?: string;
  },
  ctx: ExtractionLogContext,
  admin?: SupabaseClient,
): Promise<ExtractionPipelineResult> {
  const tAll = performance.now();
  ingestLog('info', 'extract.start', {
    ingestId: ctx.ingestId,
    traceId: ctx.traceId,
    platform: ctx.platform,
    sourceHost: ctx.sourceHost,
  });

  let llm: GeminiTryResult;
  try {
    llm = await tryOpenAiExtract(params, ctx, admin);
  } catch (e) {
    const durationMs = Math.round(performance.now() - tAll);
    const err: ExtractionError = {
      code: 'OPENAI_EXCEPTION',
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

  if (llm.kind === 'ok') {
    const durationMs = Math.round(performance.now() - tAll);
    ingestLog('info', 'extract.complete', {
      ingestId: ctx.ingestId,
      traceId: ctx.traceId,
      source: 'openai',
      productCount: llm.products.length,
      durationMs,
    });
    return {
      products: llm.products,
      extractionSource: 'openai',
      durationMs,
      extractionStatus: 'ok',
      pipelineMeta: PIPELINE_META_LEGACY,
    };
  }

  const durationMs = Math.round(performance.now() - tAll);
  const extractionError = toUserError(llm as Exclude<GeminiTryResult, { kind: 'ok' }>);
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
