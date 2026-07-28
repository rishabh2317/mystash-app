import type { SupabaseClient } from '@supabase/supabase-js';
import { ingestLog } from '../pipeline/ingestLog';

export type StageArtifactInput = {
  ingestId: string;
  pipelineRunId?: string | null;
  stage: string;
  payload: Record<string, unknown>;
  provider?: string | null;
  durationMs?: number | null;
  tokenUsage?: Record<string, unknown> | null;
  costUsd?: number | null;
  error?: unknown;
};

/** Persist one pipeline stage snapshot for audit / cost replay. */
export async function recordStageArtifact(
  admin: SupabaseClient,
  input: StageArtifactInput,
): Promise<void> {
  const errorPayload =
    input.error == null
      ? undefined
      : typeof input.error === 'object'
        ? (input.error as Record<string, unknown>)
        : { message: String(input.error).slice(0, 400) };

  const payload = {
    ...input.payload,
    ...(errorPayload ? { error: errorPayload } : {}),
  };

  const { error } = await admin.from('ingest_stage_artifacts').insert({
    ingest_request_id: input.ingestId,
    pipeline_run_id: input.pipelineRunId ?? null,
    stage: input.stage,
    payload,
    provider: input.provider ?? null,
    duration_ms: input.durationMs ?? null,
    token_usage: input.tokenUsage ?? {},
    cost_usd: input.costUsd ?? null,
  });

  if (error) {
    ingestLog('warn', 'stage_artifact.insert_failed', {
      ingestId: input.ingestId,
      stage: input.stage,
      message: error.message,
    });
  }
}

/** Rough OpenAI gpt-4o-mini cost estimate from total tokens (USD). */
export function estimateTokenCostUsd(totalTokens?: number | null): number | null {
  if (totalTokens == null || !Number.isFinite(totalTokens) || totalTokens <= 0) return null;
  // ~$0.15 / 1M input + $0.60 / 1M output — use blended mid for logging only
  return Math.round(totalTokens * 0.0000003 * 1e6) / 1e6;
}

export function summarizeProducts(products: Array<{ name?: string; confidence?: number }>): {
  count: number;
  names: string[];
  maxConfidence: number;
} {
  return {
    count: products.length,
    names: products.slice(0, 12).map((p) => String(p.name ?? '').slice(0, 80)),
    maxConfidence: products.reduce((m, p) => Math.max(m, Number(p.confidence) || 0), 0),
  };
}
