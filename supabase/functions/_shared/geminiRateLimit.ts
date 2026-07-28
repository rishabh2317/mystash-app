/**
 * DB-backed Gemini backoff on HTTP 429 so concurrent workers share cooldown state.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { ingestLog } from './ingestLog.ts';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const sec = Number.parseInt(header.trim(), 10);
  if (!Number.isFinite(sec) || sec < 1 || sec > 600) return undefined;
  return sec * 1000;
}

export async function waitGeminiBackoff(admin: SupabaseClient): Promise<void> {
  const { data } = await admin.from('gemini_rate_state').select('next_allowed_at').eq('id', 1).maybeSingle();

  const raw = data?.next_allowed_at;
  if (!raw) return;

  const ms = new Date(raw).getTime() - Date.now();
  if (ms > 0) {
    ingestLog('info', 'gemini.backoff_wait', { waitMs: Math.round(ms) });
    await sleep(ms);
  }
}

export async function recordGemini429(
  admin: SupabaseClient,
  opts: { retryAfterMs?: number; consecutiveHint?: number },
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

  ingestLog('warn', 'gemini.record_429', {
    consecutive429: n,
    cooldownUntil: until,
    usedRetryAfter: headerMs != null,
  });
}

export async function recordGeminiSuccess(admin: SupabaseClient): Promise<void> {
  await admin
    .from('gemini_rate_state')
    .update({
      consecutive_429: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);
}

export type GeminiFetchCtx = { ingestId: string; traceId: string };

/**
 * POST to Gemini generateContent with shared 429 backoff and retries (429 / 503).
 */
export async function geminiGenerateContentWithRateLimit(
  admin: SupabaseClient,
  geminiUrl: string,
  body: string,
  ctx: GeminiFetchCtx,
): Promise<{ ok: true; response: Response; totalMs: number } | { ok: false; response?: Response; totalMs: number }> {
  const MAX = 6;
  const t0 = performance.now();

  for (let attempt = 0; attempt < MAX; attempt++) {
    await waitGeminiBackoff(admin);

    const res = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (res.ok) {
      await recordGeminiSuccess(admin);
      return { ok: true, response: res, totalMs: Math.round(performance.now() - t0) };
    }

    const errText = await res.text().catch(() => '');
    const retryable = (res.status === 429 || res.status === 503) && attempt < MAX - 1;

    ingestLog('warn', 'gemini.http_attempt', {
      ingestId: ctx.ingestId,
      traceId: ctx.traceId,
      status: res.status,
      attempt,
      errSnippet: errText.slice(0, 200),
    });

    if (retryable) {
      if (res.status === 429) {
        const ra = parseRetryAfterMs(res.headers.get('Retry-After'));
        await recordGemini429(admin, { retryAfterMs: ra });
      } else {
        await sleep(Math.min(30_000, 2000 * 2 ** attempt));
      }
      continue;
    }

    return { ok: false, response: res, totalMs: Math.round(performance.now() - t0) };
  }

  return { ok: false, totalMs: Math.round(performance.now() - t0) };
}
