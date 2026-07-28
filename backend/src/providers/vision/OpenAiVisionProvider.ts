import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';
import { getPipelineConfig } from '../../config/pipelineConfig';
import type { DetectedObject } from '../../domain/types';
import { createOpenAIClient } from '../../pipeline/openaiClient';
import { openaiCompletionWithRateLimit } from '../../pipeline/openaiRateLimit';
import type { VisionDetectInput, VisionDetectOutput, VisionProvider } from './VisionProvider';

const SYSTEM = `You extract visual OBJECT FACTS only from video frames.
Return JSON: { "objects": [ { "label": string, "confidence": number, "frameIndex": number, "timestampMs": number, "bbox": { "x":0-1,"y":0-1,"w":0-1,"h":0-1 } | null } ] }
Do NOT invent product brands, prices, or shopping links. Labels are generic nouns (bicycle, bottle, laptop).`;

export class OpenAiVisionProvider implements VisionProvider {
  readonly name = 'openai-vision-objects';

  constructor(private readonly admin: SupabaseClient) {}

  async detectObjects(input: VisionDetectInput): Promise<VisionDetectOutput> {
    const t0 = performance.now();
    if (!input.frames.length) {
      return { objects: [], meta: { provider: this.name, durationMs: 0 } };
    }

    const cfg = getPipelineConfig();
    const client = createOpenAIClient();
    const parts: ChatCompletionContentPart[] = [
      {
        type: 'text',
        text: `Frames metadata: ${JSON.stringify(
          input.frames.map((f) => ({ index: f.index, timestampMs: f.timestampMs })),
        )}. List visible objects.`,
      },
    ];
    for (const f of input.frames.slice(0, 8)) {
      if (!f.base64Jpeg) continue;
      parts.push({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${f.base64Jpeg}`, detail: 'low' },
      });
    }

    const completion = await openaiCompletionWithRateLimit(
      this.admin,
      { ingestId: input.ingestId, traceId: input.traceId },
      () =>
        client.chat.completions.create({
          model: cfg.openaiVisionModel,
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 2000,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: parts },
          ],
        }),
    );

    const raw = completion.choices[0]?.message?.content?.trim() ?? '{}';
    let objects: DetectedObject[] = [];
    try {
      const j = JSON.parse(raw) as { objects?: DetectedObject[] };
      objects = Array.isArray(j.objects) ? j.objects : [];
    } catch {
      objects = [];
    }

    return {
      objects,
      meta: {
        provider: this.name,
        durationMs: Math.round(performance.now() - t0),
        tokenUsage: {
          totalTokens: completion.usage?.total_tokens,
          promptTokens: completion.usage?.prompt_tokens,
          completionTokens: completion.usage?.completion_tokens,
        },
      },
    };
  }
}
