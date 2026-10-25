import type { MultimodalContext, ProductCandidate, ProviderCallMeta } from '../../domain/types';
import type { ExtractedPlaceMention } from '../../place/parseReasonerPayload';

export type ReasonerInput = {
  context: MultimodalContext;
  ingestId: string;
  traceId: string;
  /** User-import video extraction also asks for places. Creator leaves this unset. */
  includePlaces?: boolean;
};

export type ReasonerOutput = {
  products: ProductCandidate[];
  places?: ExtractedPlaceMention[];
  meta: ProviderCallMeta;
  rawText?: string;
};

/** Product reasoning only — consumes MultimodalContext, never provider blobs. */
export interface ReasonerProvider {
  readonly name: string;
  reason(input: ReasonerInput): Promise<ReasonerOutput>;
}
