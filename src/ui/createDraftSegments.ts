/**
 * UX-CREATE-B.4 — Studio Home draft segmentation.
 * Pure helpers only; no API/schema changes.
 */

export const CREATE_DRAFT_SEGMENT_CAPS = {
  continue: 3,
  processing: 2,
  attention: 2,
} as const;

/** Hide drafts older than this from Studio Home (still exist in DB). */
export const CREATE_DRAFT_STUDIO_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type CreateDraftSegment = 'continue' | 'processing' | 'attention';

export type CreateDraftListItem = {
  id: string;
  sourceUrl: string;
  status: string;
  videoTitle?: string;
  thumbnail?: string;
  updatedAt: string;
};

export function createDraftSegmentForStatus(status: string): CreateDraftSegment | null {
  if (status === 'processing') return 'processing';
  if (status === 'failed' || status === 'review_required') return 'attention';
  if (status === 'draft' || status === 'ready_for_review') return 'continue';
  return null;
}

export function isCreateDraftFreshForStudio(
  updatedAt: string,
  nowMs: number = Date.now(),
  maxAgeMs: number = CREATE_DRAFT_STUDIO_MAX_AGE_MS,
): boolean {
  if (!updatedAt) return true;
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return true;
  return nowMs - t <= maxAgeMs;
}

export type SegmentedCreateDrafts<T extends CreateDraftListItem> = {
  continueCreating: T[];
  processing: T[];
  needsAttention: T[];
  /** True when every segment is empty after filters/caps. */
  isEmpty: boolean;
};

/**
 * Segment + prioritize Studio Home drafts.
 * - Filters out items older than 30 days
 * - Buckets by status
 * - Caps Continue (3) / Processing (2) / Needs attention (2)
 * - Preserves input order within each bucket (API returns newest first)
 */
export function segmentCreateDrafts<T extends CreateDraftListItem>(
  drafts: T[],
  opts?: { nowMs?: number; caps?: Partial<typeof CREATE_DRAFT_SEGMENT_CAPS> },
): SegmentedCreateDrafts<T> {
  const nowMs = opts?.nowMs ?? Date.now();
  const caps = { ...CREATE_DRAFT_SEGMENT_CAPS, ...opts?.caps };

  const continueCreating: T[] = [];
  const processing: T[] = [];
  const needsAttention: T[] = [];

  for (const draft of drafts) {
    if (!isCreateDraftFreshForStudio(draft.updatedAt, nowMs)) continue;
    const segment = createDraftSegmentForStatus(draft.status);
    if (segment === 'continue') {
      if (continueCreating.length < caps.continue) continueCreating.push(draft);
    } else if (segment === 'processing') {
      if (processing.length < caps.processing) processing.push(draft);
    } else if (segment === 'attention') {
      if (needsAttention.length < caps.attention) needsAttention.push(draft);
    }
  }

  return {
    continueCreating,
    processing,
    needsAttention,
    isEmpty:
      continueCreating.length === 0 &&
      processing.length === 0 &&
      needsAttention.length === 0,
  };
}

export function createDraftSegmentActionLabel(segment: CreateDraftSegment): string {
  if (segment === 'processing') return 'Open';
  if (segment === 'attention') return 'Fix';
  return 'Resume';
}
