import type { DetectedObject, FrameRef, ProviderCallMeta } from '../../domain/types';

export type VisionDetectInput = {
  frames: FrameRef[];
  ingestId: string;
  traceId: string;
};

export type VisionDetectOutput = {
  objects: DetectedObject[];
  meta: ProviderCallMeta;
};

/** Facts-only object detection from frames. Never product reasoning. */
export interface VisionProvider {
  readonly name: string;
  detectObjects(input: VisionDetectInput): Promise<VisionDetectOutput>;
}
