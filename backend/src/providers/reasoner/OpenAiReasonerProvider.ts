import type { SupabaseClient } from '@supabase/supabase-js';
import { getPipelineConfig } from '../../config/pipelineConfig';
import type { EvidenceSource } from '../../domain/types';
import { createOpenAIClient } from '../../pipeline/openaiClient';
import { openaiCompletionWithRateLimit } from '../../pipeline/openaiRateLimit';
import { buildReasonerUserPayload, buildUserImportReasonerUserPayload, PRODUCT_REASONER_SYSTEM, USER_IMPORT_REASONER_SYSTEM } from '../../prompts/productReasoner';
import { splitReasonerPayload, type ExtractedPlaceMention } from '../../place/parseReasonerPayload';
import type { ReasonerInput, ReasonerOutput, ReasonerProvider } from './ReasonerProvider';

export class OpenAiReasonerProvider implements ReasonerProvider {
  readonly name = 'openai-reasoner';

  constructor(private readonly admin: SupabaseClient) {}

  async reason(input: ReasonerInput): Promise<ReasonerOutput> {
    const t0 = performance.now();
    const cfg = getPipelineConfig();
    const client = createOpenAIClient();

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
            {
              role: 'system',
              content: input.includePlaces ? USER_IMPORT_REASONER_SYSTEM : PRODUCT_REASONER_SYSTEM,
            },
            {
              role: 'user',
              content: input.includePlaces
                ? buildUserImportReasonerUserPayload(input.context)
                : buildReasonerUserPayload(input.context),
            },
          ],
        }),
    );

    const raw = completion.choices[0]?.message?.content?.trim() ?? '';
    const split = splitReasonerPayload(raw);
    const products = split.products.map((p) => ({
      ...p,
      sources: (Array.isArray(p.sources) ? p.sources : []) as EvidenceSource[],
    }));
    const places: ExtractedPlaceMention[] | undefined = input.includePlaces ? split.places : undefined;

    const usage = completion.usage;
    return {
      products,
      places,
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
