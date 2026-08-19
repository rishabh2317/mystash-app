import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fuseHybridCandidates } from './hybrid';
import type { LexicalCandidate, VectorCandidate } from '../ports';
import type { CollectionSearchDocument } from './types';

function col(id: string): CollectionSearchDocument {
  return {
    id,
    entityType: 'collection',
    collectionId: id,
    slug: id,
    searchableText: id,
    searchTitle: id,
    searchKeywords: [],
    searchBrands: [],
    searchCategories: [],
    searchEligible: true,
    contentRevision: 1,
    indexedAt: new Date().toISOString(),
    creator: { creatorId: 'c1', displayName: 'C', username: 'c', avatarRef: null },
    primaryMediaRef: null,
    productTagCount: 0,
    publishedAt: null,
    qualityScore: null,
    viewsCount: 0,
    savesCount: 0,
    sharesCount: 0,
    productClicksCount: 0,
    creatorAuthority: 0,
    saveRate: null,
  };
}

describe('fuseHybridCandidates', () => {
  it('unions lexical and vector with RRF', () => {
    const lexical: LexicalCandidate[] = [
      { entityType: 'collection', id: 'a', score: 10, document: col('a') },
      { entityType: 'collection', id: 'b', score: 5, document: col('b') },
    ];
    const vector: VectorCandidate[] = [
      { entityType: 'collection', id: 'b', score: 0.9, document: col('b') },
      { entityType: 'collection', id: 'c', score: 0.8, document: col('c') },
    ];
    const fused = fuseHybridCandidates(lexical, vector);
    assert.equal(fused.length, 3);
    const b = fused.find((x) => x.id === 'b');
    assert.ok(b);
    assert.ok(b!.fusionScore > fused.find((x) => x.id === 'c')!.fusionScore);
  });
});
