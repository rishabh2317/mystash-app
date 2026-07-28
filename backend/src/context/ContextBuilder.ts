import type { MediaUnderstandingResult, MultimodalContext } from '../domain/types';
import { getPipelineConfig } from '../config/pipelineConfig';

export type ContextBuilderInput = {
  platform: string;
  externalVideoId: string;
  sourceUrl: string;
  metadata: MultimodalContext['metadata'];
  transcriptText: string;
  media: MediaUnderstandingResult | null;
};

export class ContextBuilder {
  build(input: ContextBuilderInput): MultimodalContext {
    const cfg = getPipelineConfig();
    const text = input.transcriptText ?? '';
    return {
      platform: input.platform,
      externalVideoId: input.externalVideoId,
      sourceUrl: input.sourceUrl,
      metadata: input.metadata,
      transcript: {
        text,
        length: text.length,
        available: text.length >= cfg.transcriptMinChars,
      },
      media: input.media,
      frames: (input.media?.frames ?? []).map((f) => ({
        index: f.index,
        timestampMs: f.timestampMs,
        storagePath: f.storagePath,
      })),
      pipelineVersion: cfg.pipelineVersion,
      providerVersion: cfg.providerVersion,
    };
  }
}
