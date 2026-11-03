import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconcileStashSync, type StashSyncPort } from './stashSync';

function fixture() {
  const acknowledged: boolean[] = []; let products = 0, places = 0;
  const port: StashSyncPort = {
    claim: async () => [{ id: 'import', user_id: 'owner', content_source_id: 'source', stash_sync_revision: 3 }],
    products: async () => { products++; }, places: async () => { places++; },
    memberships: async () => ({ savedProducts: 1, savedPlaces: 1, missingProducts: 0, missingPlaces: 0 }),
    finish: async (row, lease, success) => { assert.equal(row.stash_sync_revision, 3); assert.ok(lease); acknowledged.push(success); return true; },
  };
  return { port, acknowledged, calls: () => ({ products, places }) };
}
test('recovery retries memberships only and acknowledges verified saved or removed results', async () => {
  const f = fixture(); assert.deepEqual(await reconcileStashSync(f.port), { complete: 1, deferred: 0 });
  assert.deepEqual(f.calls(), { products: 1, places: 1 }); assert.deepEqual(f.acknowledged, [true]);
});
test('one failed save does not prevent the sibling branch, and a later tick recovers', async () => {
  const f = fixture(), original = f.port.products;
  f.port.products = async () => { throw new Error('storage failed'); };
  assert.deepEqual(await reconcileStashSync(f.port), { complete: 0, deferred: 1 });
  assert.equal(f.calls().places, 1); assert.deepEqual(f.acknowledged, [false]);
  f.port.products = original; assert.equal((await reconcileStashSync(f.port)).complete, 1);
});
test('missing entities, unavailable status, and stale completion acknowledgements stay deferred', async () => {
  const f = fixture(); f.port.memberships = async () => ({ savedProducts: 0, savedPlaces: 0, missingProducts: 1, missingPlaces: 0 });
  assert.equal((await reconcileStashSync(f.port)).deferred, 1); assert.deepEqual(f.acknowledged, [false]);
  f.port.memberships = async () => { throw new Error('unavailable'); };
  assert.equal((await reconcileStashSync(f.port)).deferred, 1);
  const g = fixture(); g.port.finish = async () => false;
  assert.equal((await reconcileStashSync(g.port)).deferred, 1);
});
