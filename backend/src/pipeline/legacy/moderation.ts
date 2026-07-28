import type { SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '../env';
import { createOpenAIClient, defaultOpenAiModel } from './openaiClient';
import { openaiCompletionWithRateLimit } from './openaiRateLimit';
import type { YoutubeContextPack } from './youtubeContext';
import type { PipelineCtx } from './pipelineVision';

/**
 * OpenAI JSON classifier — inappropriate content → unsafe.
 */
export async function moderateYoutubeContent(
  admin: SupabaseClient,
  pack: YoutubeContextPack,
  ctx: Pick<PipelineCtx, 'ingestId' | 'traceId'>,
): Promise<{ safe: boolean }> {
  if (!getEnv('OPENAI_API_KEY')) {
    return { safe: true };
  }

  const client = createOpenAIClient();
  const model = defaultOpenAiModel();

  const userContent = `You are a content safety reviewer for a general-audience shopping app.

Reply with a JSON object only: {"safe": true} or {"safe": false}.

Set safe to false only if the content clearly contains: sexual/adult material, graphic violence or gore, hate speech or harassment targeting groups, instructions for illegal weapons or drugs, self-harm encouragement, or extremist propaganda. Otherwise safe true.

Title: ${pack.title}
Channel: ${pack.authorName}
Transcript excerpt:
"""
${pack.transcript.slice(0, 12000)}
"""`;

  try {
    const completion = await openaiCompletionWithRateLimit(
      admin,
      { ingestId: ctx.ingestId, traceId: ctx.traceId },
      () =>
        client.chat.completions.create({
          model,
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 128,
          messages: [
            {
              role: 'system',
              content:
                'You output only valid JSON with a boolean field "safe". No markdown.',
            },
            { role: 'user', content: userContent },
          ],
        }),
    );

    const text = completion.choices[0]?.message?.content?.trim() ?? '';
    try {
      const parsed = JSON.parse(text) as { safe?: boolean };
      if (typeof parsed.safe === 'boolean') {
        return { safe: parsed.safe };
      }
    } catch {
      const m = text.match(/"safe"\s*:\s*(true|false)/);
      if (m?.[1] === 'false') return { safe: false };
      if (m?.[1] === 'true') return { safe: true };
    }
  } catch {
    /* fail-open */
  }

  return { safe: true };
}

/** Lightweight moderation when we only have URL + free-text context (e.g. Instagram). */
export async function moderateTextBundle(
  admin: SupabaseClient,
  ctx: Pick<PipelineCtx, 'ingestId' | 'traceId'>,
  bundle: { sourceUrl: string; platform: string; blob: string },
): Promise<{ safe: boolean }> {
  if (!getEnv('OPENAI_API_KEY')) {
    return { safe: true };
  }

  const client = createOpenAIClient();
  const model = defaultOpenAiModel();

  const userContent = `You are a content safety reviewer for a general-audience shopping app.

Reply with JSON only: {"safe":true} or {"safe":false}.

Set safe to false only if this content clearly relates to sexual/adult material, graphic violence, hate speech, illegal drug sales, weapons, self-harm, or extremism.

Platform: ${bundle.platform}
URL: ${bundle.sourceUrl}
Context:
"""
${bundle.blob.slice(0, 14000)}
"""`;

  try {
    const completion = await openaiCompletionWithRateLimit(
      admin,
      { ingestId: ctx.ingestId, traceId: ctx.traceId },
      () =>
        client.chat.completions.create({
          model,
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 128,
          messages: [
            {
              role: 'system',
              content:
                'You output only valid JSON with a boolean field "safe". No markdown.',
            },
            { role: 'user', content: userContent },
          ],
        }),
    );

    const text = completion.choices[0]?.message?.content?.trim() ?? '';
    try {
      const parsed = JSON.parse(text) as { safe?: boolean };
      if (typeof parsed.safe === 'boolean') {
        return { safe: parsed.safe };
      }
    } catch {
      /* fallthrough */
    }
  } catch {
    /* fail-open */
  }

  return { safe: true };
}
