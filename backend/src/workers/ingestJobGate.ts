/** A queue redelivery must not extract an already completed/published draft again.
 * Explicit retries reset the persisted ingest status to processing first. */
export async function runClaimedIngest<T>(
  ingestId: string,
  deps: { readStatus(id: string): Promise<string | null>; run(id: string): Promise<T> },
): Promise<T | { status: 'skipped'; reason: 'missing' | 'already_terminal' }> {
  const status = await deps.readStatus(ingestId);
  if (status === null) return { status: 'skipped', reason: 'missing' };
  if (['published', 'rejected', 'ready_for_review', 'review_required', 'failed'].includes(status)) {
    return { status: 'skipped', reason: 'already_terminal' };
  }
  return deps.run(ingestId);
}
