import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOwnerReadFence } from './ownerReadFence';
test('only the latest request for the current account may publish Stash data', () => {
  const fence = createOwnerReadFence(); fence.configure('A'); const a = fence.begin(), newer = fence.begin();
  assert.equal(fence.accepts(a),false); assert.equal(fence.accepts(newer),true);
  fence.configure('B'); assert.equal(fence.accepts(newer),false); assert.equal(fence.isOwner('A'),false);
  fence.configure('A'); assert.equal(fence.accepts(newer),false); const current = fence.begin();
  assert.equal(fence.accepts(current),true); fence.invalidate(); assert.equal(fence.accepts(current),false);
});
