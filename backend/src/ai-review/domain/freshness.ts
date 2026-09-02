/** Evidence freshness window — regeneration allowed after this interval. */
export const AI_REVIEW_EVIDENCE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Stale GENERATING locks may be reclaimed after this interval. */
export const AI_REVIEW_GENERATING_STALE_MS = 15 * 60 * 1000;

/** Back off stale READY refresh attempts after a refresh failure. */
export const AI_REVIEW_REFRESH_RETRY_BACKOFF_MS = 60 * 60 * 1000;

export function isEvidenceFresh(
  evidenceLastCheckedAt: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!evidenceLastCheckedAt) return false;
  const checked = Date.parse(evidenceLastCheckedAt);
  if (!Number.isFinite(checked)) return false;
  return nowMs - checked < AI_REVIEW_EVIDENCE_TTL_MS;
}

export function isGeneratingStale(updatedAt: string | null | undefined, nowMs = Date.now()): boolean {
  if (!updatedAt) return true;
  const ts = Date.parse(updatedAt);
  if (!Number.isFinite(ts)) return true;
  return nowMs - ts >= AI_REVIEW_GENERATING_STALE_MS;
}

export function isRefreshBackoffActive(
  refreshNextRetryAt: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!refreshNextRetryAt) return false;
  const ts = Date.parse(refreshNextRetryAt);
  if (!Number.isFinite(ts)) return false;
  return ts > nowMs;
}
