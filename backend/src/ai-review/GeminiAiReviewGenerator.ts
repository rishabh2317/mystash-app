import { getEnv } from '../env';
import { logger } from '../logger';
import { resolveAiReviewModel } from './domain/geminiModel';
import type { ProductIdentityContext } from './domain/types';
import { validateReviewOutput } from './domain/validateReviewOutput';
import type { ProductAiReviewGeneratedPayload } from './domain/types';

export type GeminiReviewGenerateResult =
  | { ok: true; payload: ProductAiReviewGeneratedPayload; model: string; sourceCount: number }
  | {
      ok: false;
      code:
        | 'config_missing'
        | 'api_error'
        | 'empty_response'
        | 'parse_failed'
        | 'validation_failed'
        | 'insufficient_evidence'
        | 'timeout';
      message: string;
      detail?: string;
    };

export type GeminiReviewGenerator = {
  generate(identity: ProductIdentityContext): Promise<GeminiReviewGenerateResult>;
};

const REQUEST_TIMEOUT_MS = 45_000;

function resolveModel(): string {
  return resolveAiReviewModel();
}

type GeminiApiError = {
  status: number;
  message: string;
  googleStatus?: string;
};

async function parseGeminiHttpError(res: Response): Promise<GeminiApiError> {
  const status = res.status;
  const raw = await res.text();
  let message = raw.slice(0, 500);
  let googleStatus: string | undefined;
  try {
    const json = JSON.parse(raw) as {
      error?: { message?: string; status?: string };
    };
    if (json.error?.message) message = json.error.message;
    googleStatus = json.error?.status;
  } catch {
    // keep raw snippet
  }
  return { status, message, googleStatus };
}

function classifyGeminiHttpError(err: GeminiApiError): {
  code: Extract<GeminiReviewGenerateResult, { ok: false }>['code'];
  message: string;
} {
  const lower = err.message.toLowerCase();
  if (
    err.status === 404 ||
    err.googleStatus === 'NOT_FOUND' ||
    lower.includes('no longer available')
  ) {
    return {
      code: 'config_missing',
      message:
        err.message ||
        'Configured Gemini model is unavailable. Set GEMINI_AI_REVIEW_MODEL to a supported model (e.g. gemini-3.5-flash-lite).',
    };
  }
  if (err.status === 401 || err.status === 403) {
    return { code: 'config_missing', message: 'Gemini API key is invalid or unauthorized' };
  }
  return { code: 'api_error', message: 'Gemini request failed' };
}

function buildPrompt(identity: ProductIdentityContext): string {
  const specs = Object.entries(identity.specifications)
    .slice(0, 12)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  return `You are a product research analyst for a shopping discovery app.

TASK
Research the EXACT product below using Google Search grounding. Do NOT rely on pretrained knowledge alone.

PRODUCT IDENTITY
- catalogProductId: ${identity.productId}
- title: ${identity.name}
- brand: ${identity.brand ?? 'unknown'}
- model: ${identity.model ?? 'unknown'}
- category: ${identity.category ?? 'unknown'}
- canonicalSlug: ${identity.canonicalSlug}
${specs ? `Specifications:\n${specs}` : ''}

RESEARCH RULES
1. Identify the exact product using the metadata above.
2. Find current independent review/opinion evidence about this exact product.
3. Prioritize genuine reviews and editorial opinions over marketing copy.
4. Use multiple independent sources when possible.
5. Separate strengths (pros) from weaknesses (cons).
6. Avoid unsupported claims, fabricated ratings, review counts, or quotes.
7. Never invent sources or URLs — only cite URLs returned by search grounding.
8. If evidence is weak or ambiguous, return fewer pros/cons and a cautious summary.

OUTPUT
Return ONLY valid JSON matching this schema:
{
  "summary": "concise decision-oriented overview",
  "pros": [{ "text": "...", "evidence": [{ "sourceId": "s1", "claim": "..." }] }],
  "cons": [{ "text": "...", "evidence": [{ "sourceId": "s1", "claim": "..." }] }],
  "sources": [{ "id": "s1", "title": "...", "url": "https://...", "domain": "example.com", "publishedAt": null }],
  "generatedAt": "ISO-8601",
  "evidenceLastCheckedAt": "ISO-8601"
}

Constraints: max 3 pros, max 3 cons, no promotional language, no star ratings.`;
}

type GroundingChunk = { web?: { uri?: string; title?: string } };

function extractGroundingUrls(response: Record<string, unknown>): Set<string> {
  const urls = new Set<string>();
  const candidates = response.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return urls;
  const first = candidates[0] as Record<string, unknown>;
  const metadata = first.groundingMetadata as Record<string, unknown> | undefined;
  const chunks = metadata?.groundingChunks;
  if (!Array.isArray(chunks)) return urls;
  for (const chunk of chunks as GroundingChunk[]) {
    const uri = chunk.web?.uri?.trim();
    if (uri?.startsWith('http')) urls.add(uri);
  }
  return urls;
}

function extractResponseText(response: Record<string, unknown>): string | null {
  const candidates = response.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const content = (candidates[0] as Record<string, unknown>).content as
    | Record<string, unknown>
    | undefined;
  const parts = content?.parts;
  if (!Array.isArray(parts)) return null;
  const texts: string[] = [];
  for (const part of parts) {
    if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
      texts.push((part as { text: string }).text);
    }
  }
  const joined = texts.join('\n').trim();
  return joined || null;
}

export function createGeminiAiReviewGenerator(): GeminiReviewGenerator {
  return {
    async generate(identity) {
      const apiKey = getEnv('GEMINI_API_KEY')?.trim();
      if (!apiKey) {
        return { ok: false, code: 'config_missing', message: 'Gemini is not configured' };
      }

      const model = resolveModel();
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const body = {
        contents: [{ role: 'user', parts: [{ text: buildPrompt(identity) }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      };

      const started = performance.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const elapsedMs = Math.round(performance.now() - started);

        if (!res.ok) {
          const apiError = await parseGeminiHttpError(res);
          const classified = classifyGeminiHttpError(apiError);
          logger.warn(
            {
              model,
              status: apiError.status,
              googleStatus: apiError.googleStatus,
              apiMessage: apiError.message,
              elapsedMs,
              productId: identity.productId,
            },
            'ai_review.gemini.http_error',
          );
          return {
            ok: false,
            code: classified.code,
            message: classified.message,
            detail: `status=${apiError.status} body=${apiError.message}`,
          };
        }

        const json = (await res.json()) as Record<string, unknown>;
        const groundingUrls = extractGroundingUrls(json);
        const text = extractResponseText(json);
        if (!text) {
          return { ok: false, code: 'empty_response', message: 'Gemini returned no text' };
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          return { ok: false, code: 'parse_failed', message: 'Gemini JSON parse failed' };
        }

        if (groundingUrls.size === 0) {
          return {
            ok: false,
            code: 'insufficient_evidence',
            message: 'No grounded web sources returned',
          };
        }

        const validated = validateReviewOutput(parsed, groundingUrls);
        if (!validated.ok) {
          return {
            ok: false,
            code: 'validation_failed',
            message: `Review output rejected: ${validated.error}`,
          };
        }

        logger.info(
          {
            model,
            elapsedMs,
            productId: identity.productId,
            sourceCount: validated.payload.sources.length,
            evidenceCount: groundingUrls.size,
          },
          'ai_review.gemini.completed',
        );

        return {
          ok: true,
          payload: validated.payload,
          model,
          sourceCount: validated.payload.sources.length,
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message.includes('abort')) {
          return { ok: false, code: 'timeout', message: 'Gemini request timed out' };
        }
        return { ok: false, code: 'api_error', message: 'Gemini request errored', detail: message };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
