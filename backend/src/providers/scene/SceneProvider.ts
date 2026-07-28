import type { ActivityInfo, FrameRef, ProviderCallMeta, SceneInfo } from '../../domain/types';

export type SceneInput = {
  frames: FrameRef[];
  ingestId: string;
  traceId: string;
};

export type SceneOutput = {
  scene: SceneInfo;
  activities: ActivityInfo[];
  meta: ProviderCallMeta;
};

export interface SceneProvider {
  readonly name: string;
  classify(input: SceneInput): Promise<SceneOutput>;
}
