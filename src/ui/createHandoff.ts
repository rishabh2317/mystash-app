/**
 * UX-CREATE-B.2 — Editor handoff.
 * Submit returns as soon as an ingest id exists; product discovery continues in the Editor.
 *
 * UX-CREATE-B.3 — mode locking for manual product addition.
 */

export function ingestEditorShowsProcessing(draft: {
  status?: string;
  extractionPending?: boolean;
  products?: unknown[];
}): boolean {
  if (draft.extractionPending) return true;
  return draft.status === 'processing';
}

/** Manual add is locked for the entire video-extraction `processing` window. */
export function ingestAllowsManualProducts(draft: {
  status?: string;
  extractionPending?: boolean;
}): boolean {
  if (draft.extractionPending) return false;
  if (draft.status === 'processing') return false;
  return (
    draft.status === 'draft' ||
    draft.status === 'ready_for_review' ||
    draft.status === 'review_required' ||
    draft.status === 'failed'
  );
}
