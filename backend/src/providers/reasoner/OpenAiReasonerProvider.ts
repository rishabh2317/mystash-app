import type { SupabaseClient } from '@supabase/supabase-js';
import { getPipelineConfig } from '../../config/pipelineConfig';
import type { EvidenceSource, ProductCandidate } from '../../domain/types';
import { createOpenAIClient } from '../../pipeline/openaiClient';
import { openaiCompletionWithRateLimit } from '../../pipeline/openaiRateLimit';
import { buildReasonerUserPayload, PRODUCT_REASONER_SYSTEM } from '../../prompts/productReasoner';
import type { ReasonerInput, ReasonerOutput, ReasonerProvider } from './ReasonerProvider';

function parseProducts(raw: string): ProductCandidate[] {
  let body = raw.trim();
  const fence = body.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fence?.[1]) body = fence[1].trim();
  try {
    const j = JSON.parse(body) as { products?: unknown };
    if (!Array.isArray(j.products)) return [];
    return j.products.filter((p) => p && typeof p === 'object') as ProductCandidate[];
  } catch {
    return [];
  }
}

export class OpenAiReasonerProvider implements ReasonerProvider {
  readonly name = 'openai-reasoner';

  constructor(private readonly admin: SupabaseClient) {}

  async reason(input: ReasonerInput): Promise<ReasonerOutput> {
    const t0 = performance.now();
    const cfg = getPipelineConfig();
    const client = createOpenAIClient();
    const contextJson = JSON.stringify(input.context, null, 0).slice(0, 100_000);

    const completion = await openaiCompletionWithRateLimit(
      this.admin,
      { ingestId: input.ingestId, traceId: input.traceId },
      () =>
        client.chat.completions.create({
          model: cfg.openaiReasonerModel,
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_tokens: 4096,
          messages: [
            { role: 'system', content: PRODUCT_REASONER_SYSTEM },
            { role: 'user', content: buildReasonerUserPayload(contextJson) },
          ],
        }),
    );

    const raw = completion.choices[0]?.message?.content?.trim() ?? '';
    const products = parseProducts(raw).map((p) => ({
      ...p,
      sources: (Array.isArray(p.sources) ? p.sources : []) as EvidenceSource[],
    }));

    const usage = completion.usage;
    return {
      products,
      rawText: raw,
      meta: {
        provider: this.name,
        durationMs: Math.round(performance.now() - t0),
        tokenUsage: {
          promptTokens: usage?.prompt_tokens,
          completionTokens: usage?.completion_tokens,
          totalTokens: usage?.total_tokens,
        },
      },
    };
  }
}
