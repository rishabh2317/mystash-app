import { reviewVerificationStatus } from '@/src/services/reviewResolution';
import type { IngestDraftPayload } from '@/src/types/curation';

export type IngestProgressStageState = 'pending' | 'active' | 'complete' | 'failed';

export type IngestProgressStageView = {
  id: string;
  label: string;
  state: IngestProgressStageState;
};

const VIDEO_STAGE_DEFS = [
  { id: 'content', label: 'Content' },
  { id: 'finding', label: 'Finding products' },
  { id: 'verifying', label: 'Verifying products' },
  { id: 'preparing', label: 'Preparing your collection' },
] as const;

const MANUAL_STAGE_DEFS = [
  { id: 'adding', label: 'Adding products' },
  { id: 'checking', label: 'Checking product details' },
  { id: 'preparing', label: 'Preparing products' },
] as const;

const STUDIO_STAGE_DEFS = [
  { id: 'starting', label: 'Starting your Collection' },
  { id: 'opening', label: 'Opening Collection editor' },
] as const;

function buildStages(
  defs: readonly { id: string; label: string }[],
  activeIndex: number,
  failedIndex?: number,
): IngestProgressStageView[] {
  const capped = Math.max(0, Math.min(activeIndex, defs.length - 1));
  return defs.map((def, index) => ({
    id: def.id,
    label: def.label,
    state:
      failedIndex === index
        ? 'failed'
        : index < capped
          ? 'complete'
          : index === capped
            ? 'active'
            : 'pending',
  }));
}

function hasPipelineFindingProgress(stagesCompleted: string[] | undefined): boolean {
  if (!stagesCompleted?.length) return false;
  return stagesCompleted.some((stage) =>
    /^(s1_|reason_|validate_|rank_|stage[123]|s2_|s3_|matcher|retrieval)/i.test(stage),
  );
}

function productsNeedVerification(products: IngestDraftPayload['products']): boolean {
  if (!products.length) return false;
  return products.some((product) => {
    const status = reviewVerificationStatus(product);
    return status === 'RESOLVING' || status === 'UNRESOLVED' || !product.catalogProductId;
  });
}

/** Maps async video extraction draft state → staged progress (no fake percentages). */
export function resolveVideoExtractionProgressStageIndex(draft: IngestDraftPayload): number {
  const stagesCompleted = draft.pipelineMeta?.stagesCompleted;
  const hasContent = Boolean(draft.sourceUrl?.trim());

  if (!hasContent && !hasPipelineFindingProgress(stagesCompleted) && draft.products.length === 0) {
    return 0;
  }
  if (draft.products.length === 0) {
    return 1;
  }
  if (productsNeedVerification(draft.products)) {
    return 2;
  }
  return 3;
}

export function mapVideoExtractionStages(draft: IngestDraftPayload): IngestProgressStageView[] {
  return buildStages(VIDEO_STAGE_DEFS, resolveVideoExtractionProgressStageIndex(draft));
}

export function mapManualProductLinkStages(activeIndex: number): IngestProgressStageView[] {
  return buildStages(MANUAL_STAGE_DEFS, activeIndex);
}

export function mapStudioSubmitStages(activeIndex: number): IngestProgressStageView[] {
  return buildStages(STUDIO_STAGE_DEFS, activeIndex);
}

export function activeIngestProgressLabel(stages: IngestProgressStageView[]): string {
  return stages.find((stage) => stage.state === 'active')?.label ?? stages[0]?.label ?? '';
}

/** Segmented progress only — never expose a numeric percentage without backend support. */
export function usesNumericIngestProgress(_stages: IngestProgressStageView[]): boolean {
  return false;
}
