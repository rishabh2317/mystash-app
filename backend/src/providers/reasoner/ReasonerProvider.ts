import type { MultimodalContext, ProductCandidate, ProviderCallMeta } from '../../domain/types';

export type ReasonerInput = {
  context: MultimodalContext;
  ingestId: string;
  traceId: string;
};

export type ReasonerOutput = {
  products: ProductCandidate[];
  meta: ProviderCallMeta;
  rawText?: string;
};

/** Product reasoning only — consumes MultimodalContext, never provider blobs. */
export interface ReasonerProvider {
  readonly name: string;
  reason(input: ReasonerInput): Promise<ReasonerOutput>;
}
