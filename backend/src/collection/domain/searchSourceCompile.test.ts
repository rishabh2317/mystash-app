import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileSearchSourceFields } from './searchSourceCompile';

describe('compileSearchSourceFields', () => {
  it('compiles title, brands, categories, and intent keywords', () => {
    const fields = compileSearchSourceFields({
      title: 'My Fold Review',
      caption: 'Best foldable this year',
      recommendationIntent: 'review',
      recommendationIntentsSecondary: ['gaming'],
      tags: [
        {
          includeInPublish: true,
          visibility: 'visible',
          tagStatus: 'accepted',
          deletedAt: null,
          brandSnapshot: 'Samsung',
          categorySnapshot: 'Phones',
          nameSnapshot: 'Galaxy Z Fold 8',
        },
        {
          includeInPublish: false,
          visibility: 'visible',
          tagStatus: 'accepted',
          deletedAt: null,
          brandSnapshot: 'Ignored',
          categorySnapshot: 'Skip',
          nameSnapshot: 'Hidden',
        },
      ],
    });

    assert.equal(fields.searchTitle, 'My Fold Review');
    assert.ok(fields.searchText?.includes('Best foldable'));
    assert.ok(fields.searchBrands.includes('Samsung'));
    assert.ok(!fields.searchBrands.includes('Ignored'));
    assert.ok(fields.searchKeywords.includes('review'));
    assert.ok(fields.searchCategories.includes('Phones'));
    assert.ok(fields.searchCategories.includes('gaming'));
  });
});
