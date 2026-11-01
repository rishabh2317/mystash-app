import type { PlaceRepository } from './PlaceRepository';
import { PlaceRepositoryError } from './PlaceRepository';

/** Attach existing discoveries for a late importer; never calls AI or a search provider. */
export async function syncImportPlaces(repository: PlaceRepository, row: {
  id: string; userId: string; contentSourceId: string | null;
}): Promise<void> {
  if (!row.contentSourceId) return;
  for (const hypothesis of await repository.listHypotheses(row.contentSourceId)) {
    const existing = await repository.findSaveByUserAndHypothesis(row.userId, hypothesis.id);
    if (existing) {
      if (hypothesis.placeId && existing.placeId !== hypothesis.placeId) {
        await repository.upgradeLead(existing.id, hypothesis.placeId);
      }
    }
    try {
      await repository.insertLead({
        userId: row.userId, userImportId: row.id,
        contentSourceId: row.contentSourceId, contentSourcePlaceId: hypothesis.id,
      });
    } catch (err) {
      if (!(err instanceof PlaceRepositoryError) || err.code !== 'duplicate') throw err;
    }
  }
}

/** Discovery count, including already-saved identities, rather than new-save count. */
export async function sourcePlaceCounts(repository: PlaceRepository, sourceId: string) {
  const hypotheses = await repository.listHypotheses(sourceId);
  const resolved = new Set(hypotheses.flatMap((row) => row.placeId ? [row.placeId] : []));
  const unverified = hypotheses.filter((row) => !row.placeId).length;
  return { resolved: resolved.size, unverified, total: resolved.size + unverified };
}
