/**
 * DB-backed 429 backoff for OpenAI (reuses `gemini_rate_state` table for shared cooldown).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ingestLog } from './ingestLog';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitOpenAiBackoff(admin: SupabaseClient): Promise<void> {
  const { data } = await admin.from('gemini_rate_state').select('next_allowed_at').eq('id', 1).maybeSingle();

  const raw = data?.next_allowed_at;
  if (!raw) return;

  const ms = new Date(raw).getTime() - Date.now();
  if (ms > 0) {
    ingestLog('info', 'openai.backoff_wait', { waitMs: Math.round(ms) });
    await sleep(ms);
  }
}

export async function recordOpenAi429(
  admin: SupabaseClient,
  opts: { retryAfterMs?: number },
): Promise<void> {
  const { data } = await admin.from('gemini_rate_state').select('consecutive_429').eq('id', 1).maybeSingle();
  const n = (data?.consecutive_429 ?? 0) + 1;
  const headerMs = opts.retryAfterMs;
  const expMs = Math.min(180_000, 2500 * 2 ** Math.min(n, 8));
  const base = headerMs ?? expMs;
  const jitter = Math.floor(Math.random() * 1200);
  const until = new Date(Date.now() + base + jitter).toISOString();

  await admin
    .from('gemini_rate_state')
    .update({
      next_allowed_at: until,
      consecutive_429: n,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);

  ingestLog('warn', 'openai.record_429', {
    consecutive429: n,
    cooldownUntil: until,
    usedRetryAfter: headerMs != null,
  });
}

export async function recordOpenAiSuccess(admin: SupabaseClient): Promise<void> {
  await admin
    .from('gemini_rate_state')
    .update({
      consecutive_429: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);
}

export type OpenAiFetchCtx = { ingestId: string; traceId: string };

function httpStatus(e: unknown): number | undefined {
  if (e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number') {
    return (e as { status: number }).status;
  }
  return undefined;
}

function isRetryableOpenAiError(e: unknown): { retryable: boolean; status?: number } {
  const s = httpStatus(e);
  if (s === 429 || s === 503) return { retryable: true, status: s };
  return { retryable: false, status: s };
}

/**
 * Runs an OpenAI SDK call with shared DB backoff on 429/503.
 */
export async function openaiCompletionWithRateLimit<T>(
  admin: SupabaseClient,
  ctx: OpenAiFetchCtx,
  operation: () => Promise<T>,
): Promise<T> {
  const MAX = 6;
  const t0 = performance.now();

  for (let attempt = 0; attempt < MAX; attempt++) {
    await waitOpenAiBackoff(admin);

    try {
      const result = await operation();
      await recordOpenAiSuccess(admin);
      void Math.round(performance.now() - t0);
      return result;
    } catch (e: unknown) {
      const { retryable, status } = isRetryableOpenAiError(e);
      const msg = e instanceof Error ? e.message.slice(0, 200) : String(e);

      ingestLog('warn', 'openai.attempt', {
        ingestId: ctx.ingestId,
        traceId: ctx.traceId,
        status: status ?? 'unknown',
        attempt,
        errSnippet: msg,
      });

      if (retryable && attempt < MAX - 1) {
        if (status === 429) {
          await recordOpenAi429(admin, {});
        } else {
          await sleep(Math.min(30_000, 2000 * 2 ** attempt));
        }
        continue;
      }

      throw e;
    }
  }

  throw new Error('openaiCompletionWithRateLimit: exceeded retries');
}
