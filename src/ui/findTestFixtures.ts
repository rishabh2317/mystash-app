/** Synthetic offline fixtures used only by Find tests and render checks. */
import type { FindItem, FindScreenDetail } from '@/src/services/findClient';
export const findFixtureId = (n: number) => `11111111-1111-4111-8111-${n.toString(16).padStart(12,'0')}`;
export function findFixture(n = 1, category: 'completed' | 'processing' | 'attention' = 'completed'): FindItem {
  return { id: findFixtureId(n), createdAt: new Date(Date.parse('2026-11-03T10:00:00Z')-n*60000).toISOString(), sourceType: n%2 ? 'instagram' : 'youtube',
    sourceUrl: 'https://www.youtube.com/shorts/abcdefghijk', contentSourceId: findFixtureId(1000+n), title: n%2 ? 'A weekend in the city' : 'Everyday favourites', thumbnailUrl: null,
    intent: { kind: null, note: null, revision: 0 }, outcome: { version: 1, category, result: category === 'attention' ? 'partial' : 'found',
      products: category === 'processing' ? 'running' : 'complete', places: category === 'attention' ? 'failed' : 'complete',
      foundProducts: 2, foundPlaces: 1, resolvedPlaces: 1, unverifiedPlaces: 0, savedProducts: 2, savedPlaces: 1,
      stashSync: category === 'processing' ? 'pending' : 'complete', canRetryExtraction: category === 'attention', canRetrySaving: false,
      extractionActive: category === 'processing', delayed: false, finishedAt: category === 'processing' ? null : '2026-11-03T10:01:00Z' } };
}
export function findDetailFixture(): FindScreenDetail {
  const item = findFixture();
  return { ...item, outcome: { ...item.outcome, foundProducts: 3, savedProducts: 2 }, capabilities: { intent: true, suggestions: true },
    products: [
      { id: findFixtureId(100), title: 'Everyday camera', imageUrl: null, catalogProductId: findFixtureId(200), discoveredProductId: null, identityKey: `c:${findFixtureId(200)}`, matchKind: 'exact', saved: true, removed: false },
      { id: findFixtureId(101), title: 'Linen jacket', imageUrl: null, catalogProductId: findFixtureId(201), discoveredProductId: null, identityKey: `c:${findFixtureId(201)}`, matchKind: 'exact', saved: false, removed: true },
    ],
    places: [{ id: findFixtureId(300), name: 'Corner café', locality: 'Old town', city: 'Paris', placeId: findFixtureId(301), resolution: 'resolved', saved: true, removed: false }],
    savedSuggestions: [{ sourceProductId: findFixtureId(102), candidateKey: 'a'.repeat(64), identityKey: `d:${findFixtureId(202)}`, title: 'Brown leather handbag', imageUrl: null, matchKind: 'similar', saved: true, removed: false }] };
}
