import type { ChatCompletion } from 'openai/resources/chat/completions';
import type { TokenUsage } from '../domain/types';
import { ingestLog } from './ingestLog';

/** Keep the existing Chat/JSON contract. Luna reasoning cannot use temperature. */
export function activeChatParameters(model: string, tokenLimit: number, temperature: number) {
  return /^gpt-6-luna(?:-|$)/.test(model)
    ? { reasoning_effort: 'low' as const, max_completion_tokens: tokenLimit }
    : { temperature, max_tokens: tokenLimit };
}

type Integration = 'vision' | 'scene' | 'reasoner' | 'merchant';

/** Metadata only: never log prompts, images, URLs, merchant text or completions. */
export function recordOpenAiCompletion(
  context: { ingestId: string; traceId: string }, integration: Integration,
  requestedModel: string, completion: Pick<ChatCompletion, 'model' | 'usage' | 'choices'>,
  durationMs: number,
): TokenUsage {
  const usage = completion.usage;
  const tokenUsage: TokenUsage = {
    promptTokens: usage?.prompt_tokens,
    completionTokens: usage?.completion_tokens,
    totalTokens: usage?.total_tokens,
    reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens,
    cachedTokens: usage?.prompt_tokens_details?.cached_tokens,
  };
  ingestLog('info', 'openai.usage', {
    ingestId: context.ingestId, traceId: context.traceId,
    integration, requestedModel, model: completion.model,
    reasoningEffort: /^gpt-6-luna(?:-|$)/.test(requestedModel) ? 'low' : undefined,
    ...tokenUsage, durationMs, finishReason: completion.choices[0]?.finish_reason,
  });
  return tokenUsage;
}
