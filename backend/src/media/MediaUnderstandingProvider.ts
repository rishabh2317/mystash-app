import type { FrameRef, MediaUnderstandingResult } from '../domain/types';

export type MediaUnderstandingInput = {
  frames: FrameRef[];
  ingestId: string;
  traceId: string;
};

export interface MediaUnderstandingProvider {
  readonly name: string;
  /** Facts only — never product reasoning. */
  analyze(input: MediaUnderstandingInput): Promise<MediaUnderstandingResult>;
}
