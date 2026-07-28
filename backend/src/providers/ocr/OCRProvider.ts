import type { FrameRef, OcrLine, ProviderCallMeta } from '../../domain/types';

export type OcrInput = {
  frames: FrameRef[];
  ingestId: string;
  traceId: string;
};

export type OcrOutput = {
  lines: OcrLine[];
  meta: ProviderCallMeta;
};

export interface OCRProvider {
  readonly name: string;
  extractText(input: OcrInput): Promise<OcrOutput>;
}
