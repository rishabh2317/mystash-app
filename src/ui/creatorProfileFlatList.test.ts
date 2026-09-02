import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CREATOR_PROFILE_FLATLIST_KEYS } from './creatorProfileFlatList';

describe('CreatorProfile FlatList keys', () => {
  it('uses distinct stable keys per tab layout so numColumns can differ', () => {
    const { collections, products } = CREATOR_PROFILE_FLATLIST_KEYS;
    assert.notEqual(collections, products);
    assert.match(collections, /^creator-profile-/);
    assert.match(products, /^creator-profile-/);
  });
});
