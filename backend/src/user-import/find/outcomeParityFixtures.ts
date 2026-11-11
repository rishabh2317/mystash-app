/** Offline SQL/reference equivalence corpus. Not imported by API or workers. */
import { projectFindOutcome, type FindMembershipSnapshot } from './outcome';
const start = '2026-11-03T00:00:00.000Z';
const cases: unknown[] = [];
for (const status of [null,'RECEIVED','QUEUED','PROCESSING','READY','FAILED'] as const)
for (const mediaKind of ['VIDEO','WEB_PAGE'] as const)
for (const branch of [null,'running','complete','failed','stale'] as const)
for (const sync of [null,'pending','complete','failed'] as const)
for (const missing of [0,1])
for (const discovery of [0,1])
for (const found of [0,1])
for (const late of [false,true]) {
  const snapshot: FindMembershipSnapshot = { discoveryProducts:discovery, foundProducts: found, foundPlaces: found, resolvedPlaces: 0, unverifiedPlaces: found,
    savedProducts: missing ? 0 : found, savedPlaces: 0, missingProducts: missing, missingPlaces: 0,
    snapshot: { source: status ? { processingStatus: status, mediaKind, queuedAt: start } : null,
      progress: branch ? { attemptId: 'attempt', startedAt: branch === 'stale' ? '2026-11-02T00:00:00Z' : start,
        finishedAt: branch === 'complete' || branch === 'failed' ? '2026-11-03T00:01:00Z' : null,
        extractionVersion: 'fixture', products: branch === 'stale' ? 'complete' : branch, places: branch === 'failed' ? 'complete' : branch === 'stale' ? 'complete' : branch,
        evidenceComplete: branch === 'complete' } : null,
      syncState: sync, syncAttemptId: sync === 'failed' ? 'old' : 'attempt', startedAt: start },
  };
  const now = new Date(Date.parse(start) + (late ? 900_000 : 60_000)).toISOString();
  cases.push({ row: { discovery_products:discovery, found_products: snapshot.foundProducts, found_places: snapshot.foundPlaces, resolved_places: snapshot.resolvedPlaces,
    unverified_places: snapshot.unverifiedPlaces, saved_products: snapshot.savedProducts, saved_places: snapshot.savedPlaces,
    missing_products: snapshot.missingProducts, missing_places: snapshot.missingPlaces, report: snapshot.snapshot },
    now, expected: projectFindOutcome(snapshot, Date.parse(now)) });
}
process.stdout.write(JSON.stringify(cases));
