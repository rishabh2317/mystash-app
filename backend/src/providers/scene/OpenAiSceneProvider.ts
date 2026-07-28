import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';
import { getPipelineConfig } from '../../config/pipelineConfig';
import type { ActivityInfo, SceneInfo } from '../../domain/types';
import { createOpenAIClient } from '../../pipeline/openaiClient';
import { openaiCompletionWithRateLimit } from '../../pipeline/openaiRateLimit';
import type { SceneInput, SceneOutput, SceneProvider } from './SceneProvider';

const SYSTEM = `Classify the SCENE and ACTIVITIES visible in these frames.
Return JSON only: { "scene": { "label": string, "confidence": number, "environment": string }, "activities": [ { "label": string, "confidence": number } ] }
Prefer labels like: Cycling, Office, Gym, Kitchen, Gaming Setup, Camping, Coffee Shop, Street Fashion, Travel, Unknown.
Facts only — no product shopping reasoning.`;

export class OpenAiSceneProvider implements SceneProvider {
  readonly name = 'openai-scene';

  constructor(private readonly admin: SupabaseClient) {}

  async classify(input: SceneInput): Promise<SceneOutput> {
    const t0 = performance.now();
    if (!input.frames.length) {
      return {
        scene: { label: 'unknown', confidence: 0 },
        activities: [],
        meta: { provider: this.name, durationMs: 0 },
      };
    }

    const cfg = getPipelineConfig();
    const client = createOpenAIClient();
    const parts: ChatCompletionContentPart[] = [{ type: 'text', text: 'Classify scene and activities.' }];
    for (const f of input.frames.slice(0, 4)) {
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
          max_tokens: 800,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: parts },
          ],
        }),
    );

    const raw = completion.choices[0]?.message?.content?.trim() ?? '{}';
    let scene: SceneInfo = { label: 'unknown', confidence: 0 };
    let activities: ActivityInfo[] = [];
    try {
      const j = JSON.parse(raw) as { scene?: SceneInfo; activities?: ActivityInfo[] };
      if (j.scene?.label) scene = j.scene;
      if (Array.isArray(j.activities)) activities = j.activities;
    } catch {
      /* keep defaults */
    }

    return {
      scene,
      activities,
      meta: {
        provider: this.name,
        durationMs: Math.round(performance.now() - t0),
        tokenUsage: { totalTokens: completion.usage?.total_tokens },
      },
    };
  }
}
