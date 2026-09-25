import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { detailsUpdatingFromMetadata } from './detailsUpdating';

describe('detailsUpdatingFromMetadata', () => {
  it('is true only for enrichmentStatus pending', () => {
    assert.equal(detailsUpdatingFromMetadata({ enrichmentStatus: 'pending' }), true);
    assert.equal(detailsUpdatingFromMetadata({ enrichmentStatus: 'ready' }), false);
    assert.equal(detailsUpdatingFromMetadata({}), false);
    assert.equal(detailsUpdatingFromMetadata(null), false);
  });
});
