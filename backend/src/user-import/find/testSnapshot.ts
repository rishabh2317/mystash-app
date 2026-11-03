import type { UserImportRepository } from '../UserImportRepository';
import type { UserImportContentSourcePort } from '../ports';
import type { ImportProgressRepository } from '../ImportProgressRepository';
import { projectFindOutcome, type FindMembershipCounts, type FindMembershipSnapshot } from './outcome';

/** In-memory test adapter for the SQL snapshot contract. No production imports. */
export function testSnapshots(imports: UserImportRepository, sources: Pick<UserImportContentSourcePort, 'getById' | 'listProducts'>,
  options: { progress?: ImportProgressRepository; places?: (id: string) => Promise<number>; now?: () => number } = {}) {
  return async (userId: string, ids: string[]) => {
    const rows: [string, FindMembershipCounts][] = [];
    for (const id of ids) {
      const row = await imports.findById(id);
      if (!row || row.userId !== userId || row.hiddenAt) continue;
      const progress = row.contentSourceId ? await options.progress?.get(row.contentSourceId) ?? null : null;
      const source = row.contentSourceId ? await sources.getById(row.contentSourceId) : null;
      const products = row.contentSourceId ? await sources.listProducts(row.contentSourceId) : [];
      const count = new Set(products.map(p => p.catalogProductId ?? p.discoveredProductId).filter(Boolean)).size;
      const places = await options.places?.(id) ?? 0;
      const membership: FindMembershipSnapshot = { foundProducts: count, foundPlaces: places, resolvedPlaces: 0, unverifiedPlaces: places, savedProducts: count, savedPlaces: places,
        missingProducts: 0, missingPlaces: 0,
        snapshot: { source, progress, syncState: 'complete', syncAttemptId: progress?.attemptId ?? null,
          startedAt: row.attemptStartedAt ?? row.createdAt } };
      rows.push([id, { ...membership, selectedProducts: [], outcome: projectFindOutcome(membership, options.now?.()) }]);
    }
    return new Map(rows);
  };
}
