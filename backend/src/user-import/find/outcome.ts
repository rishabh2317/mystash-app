import type { ContentSourceRecord } from '../../content-source/domain/types';
import type { ImportProgress } from '../ImportProgressRepository';

import type { FindOutcome, StashSyncState } from './contract';
export type { FindOutcome, StashSyncState } from './contract';
export type FindReportSnapshot = {
  source: Pick<ContentSourceRecord, 'processingStatus' | 'mediaKind' | 'queuedAt'> | null;
  progress: ImportProgress | null;
  syncState: StashSyncState | null;
  syncAttemptId: string | null;
  startedAt: string;
};
export type FindMembershipSnapshot = {
  discoveryProducts?: number;
  foundProducts: number; foundPlaces: number; resolvedPlaces: number; unverifiedPlaces: number; savedProducts: number; savedPlaces: number;
  missingProducts: number; missingPlaces: number;
  /** Status and counts must come from the same database statement snapshot. */
  snapshot: FindReportSnapshot;
};
export type FindMembershipCounts = FindMembershipSnapshot & { outcome: FindOutcome; selectedProducts: { productId: string; title: string; imageUrl: string | null }[] };

/** Incomplete pre-foundation rows stay visible, but are never automatically backfilled. */
function incompleteOutcome(membership: FindMembershipSnapshot): FindOutcome {
  return { version: 1, discoveryProducts: membership.discoveryProducts ?? 0, category: 'attention', result: 'failed', products: 'unknown', places: 'unknown',
    foundProducts: membership.foundProducts, foundPlaces: membership.foundPlaces, resolvedPlaces: membership.resolvedPlaces, unverifiedPlaces: membership.unverifiedPlaces,
    savedProducts: membership.savedProducts, savedPlaces: membership.savedPlaces,
    stashSync: 'unavailable', canRetryExtraction: Boolean(membership.snapshot.source &&
      ['READY', 'FAILED'].includes(membership.snapshot.source.processingStatus)),
    canRetrySaving: false, extractionActive: false, delayed: false, finishedAt: null };
}

/** Offline reference for in-memory tests and SQL parity verification. Production reads use find_project_outcome. */
export function projectFindOutcome(membership: FindMembershipSnapshot, nowMs = Date.now()): FindOutcome {
  const report = membership.snapshot;
  const { source } = report;
  if (!source || !report.syncState) return incompleteOutcome(membership);
  const progress = report.progress && (!source.queuedAt || Date.parse(report.progress.startedAt) >= Date.parse(source.queuedAt))
    ? report.progress : null;
  const terminal = source.processingStatus === 'READY' || source.processingStatus === 'FAILED';
  const fallback = source.processingStatus === 'FAILED' ? 'failed' : terminal ? 'complete' : 'running';
  const products = progress?.products ?? fallback;
  const places = progress?.places ?? (source.mediaKind === 'WEB_PAGE' ? 'complete' : fallback);
  const found = membership.foundProducts + membership.foundPlaces + (membership.discoveryProducts ?? 0) > 0;
  const failed = products === 'failed' || places === 'failed' || source.processingStatus === 'FAILED';
  const running = !terminal || products === 'running' || places === 'running';
  const staleSync = progress && report.syncAttemptId !== progress.attemptId;
  const missing = membership.missingProducts + membership.missingPlaces > 0;
  const stashSync: StashSyncState = staleSync || missing
    ? report.syncState === 'failed' && !staleSync ? 'failed' : 'pending' : report.syncState;
  const startedMs = Math.max(...[report.startedAt, source.queuedAt, progress?.startedAt]
    .filter((v): v is string => Boolean(v)).map(Date.parse));
  const delayed = running && Number.isFinite(startedMs) && nowMs - startedMs >= 10 * 60 * 1000;
  return {
    version: 1, discoveryProducts: membership.discoveryProducts ?? 0,
    category: running ? 'processing'
      : stashSync === 'failed' || (failed && !found) ? 'attention' : stashSync !== 'complete' ? 'processing' : 'completed',
    result: found ? failed ? 'partial' : 'found' : running ? 'pending' : failed ? 'failed' : 'empty',
    products, places, foundProducts: membership.foundProducts, foundPlaces: membership.foundPlaces, resolvedPlaces: membership.resolvedPlaces, unverifiedPlaces: membership.unverifiedPlaces,
    savedProducts: membership.savedProducts, savedPlaces: membership.savedPlaces, stashSync, extractionActive: running, delayed,
    canRetryExtraction: terminal && !running && failed,
    canRetrySaving: terminal && !running && (stashSync === 'pending' || stashSync === 'failed'),
    finishedAt: terminal && !running ? progress?.finishedAt ?? null : null,
  };
}
