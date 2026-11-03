import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CartService } from './CartService';
import { InMemoryCartRepository } from './InMemoryCartRepository';
import type { CatalogProduct } from '../product-intelligence/domain/types';
import type { DiscoveredProductRecord } from '../discovered/domain/types';

const user = '11111111-1111-4111-8111-111111111111';
const product = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
function fixture() {
  const repo = new InMemoryCartRepository();
  const cart = new CartService(repo, { resolveActiveProduct: async id => ({ id, status: 'ACTIVE' } as CatalogProduct),
    getById: async () => null, getProductsByIds: async () => new Map() }, {
    getById: async id => ({ id, internalStatus: 'ACTIVE' } as DiscoveredProductRecord),
  });
  return { repo, cart };
}
test('automatic capture saves immediately, then removal survives retries and explicit add restores the same row', async () => {
  const { repo, cart } = fixture();
  const first = await cart.addItem(user, { catalogProductId: product, automatic: true });
  assert.equal(first.created, true); assert.equal((await repo.listByUser(user)).length, 1);
  await cart.removeItem(user, product);
  const replay = await cart.addItem(user, { catalogProductId: product, automatic: true });
  assert.equal(replay.suppressed, true); assert.equal((await repo.listByUser(user)).length, 0);
  const restored = await cart.addItem(user, { catalogProductId: product });
  assert.equal(restored.item.id, first.item.id); assert.equal(restored.suppressed, false);
  assert.equal((await repo.listByUser(user)).length, 1);
});
test('discovered memberships follow the same automatic/explicit rules and owner isolation', async () => {
  const { cart, repo } = fixture();
  await cart.addItem(user, { discoveredProductId: product, automatic: true });
  await cart.removeItem(user, product);
  assert.equal((await cart.addItem(user, { discoveredProductId: product, automatic: true })).suppressed, true);
  await cart.addItem(other, { discoveredProductId: product, automatic: true });
  assert.equal((await repo.listByUser(other)).length, 1);
  await cart.addItem(user, { discoveredProductId: product });
  assert.equal((await repo.listByUser(user)).length, 1);
});
test('concurrent remove and automatic add cannot resurrect a removed membership', async () => {
  const { cart, repo } = fixture();
  await cart.addItem(user, { catalogProductId: product, automatic: true });
  await Promise.all([cart.addItem(user, { catalogProductId: product, automatic: true }), cart.removeItem(user, product)]);
  await cart.addItem(user, { catalogProductId: product, automatic: true });
  assert.equal((await repo.listByUser(user)).length, 0);
});
test('catalog merge retains the latest explicit decision rather than losing the removal row', async () => {
  const { cart, repo } = fixture();
  const a = await cart.addItem(user, { catalogProductId: product, automatic: true });
  const b = await cart.addItem(user, { catalogProductId: other });
  repo.items.set(a.item.id, { ...a.item, removedAt: '2026-11-03T01:00:00Z', explicitActionAt: '2026-11-03T01:00:00Z' });
  repo.items.set(b.item.id, { ...b.item, explicitActionAt: '2026-11-03T00:00:00Z' });
  await cart.remapAfterCatalogMerge(product, other);
  assert.equal((await repo.listByUser(user)).length, 0);
  assert.equal((await cart.addItem(user, { catalogProductId: other, automatic: true })).suppressed, true);
  await cart.addItem(user, { catalogProductId: other });
  assert.equal((await repo.listByUser(user)).length, 1);
});
