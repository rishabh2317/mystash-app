import type { DetectedLogo, FrameRef, ProviderCallMeta } from '../../domain/types';

export type LogoInput = {
  frames: FrameRef[];
  ingestId: string;
  traceId: string;
};

export type LogoOutput = {
  logos: DetectedLogo[];
  meta: ProviderCallMeta;
};

export interface LogoProvider {
  readonly name: string;
  detectLogos(input: LogoInput): Promise<LogoOutput>;
}
