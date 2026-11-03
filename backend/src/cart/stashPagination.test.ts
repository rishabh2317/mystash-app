import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseCartRepository } from './SupabaseCartRepository';

it('reads every authenticated saved-product page with stable ordering beyond the database row cap', async () => {
  const ranges: [number, number][] = [];
  const ordering: string[] = [];
  const client = { from(table: string) {
    assert.equal(table, 'cart_items');
    const query = { select(value: string) { assert.equal(value, '*'); return query; },
      is(field: string, value: unknown) { assert.equal(field, 'removed_at'); assert.equal(value, null); return query; },
      eq(field: string, value: string) { assert.equal(field, 'user_id'); assert.equal(value, 'owner'); return query; },
      order(field: string) { ordering.push(field); return query; },
      async range(from: number, to: number) {
        ranges.push([from, to]);
        return { data: Array.from({ length: Math.max(0, Math.min(1101, to + 1) - from) }, (_, i) => ({
          id: `save-${from + i}`, user_id: 'owner', catalog_product_id: `product-${from + i}`, added_at: '2026-10-30', schema_version: 1,
        })), error: null };
      } };
    return query;
  } } as unknown as SupabaseClient;
  const items = await new SupabaseCartRepository(client).listByUser('owner');
  assert.equal(items.length, 1101); assert.equal(items[1100].id, 'save-1100');
  assert.deepEqual(ranges, [[0, 499], [500, 999], [1000, 1499]]);
  assert.deepEqual(ordering, ['added_at', 'id', 'added_at', 'id', 'added_at', 'id']);
});

it('propagates a later-page error rather than pretending an incomplete saved list is complete', async () => {
  const client = { from() {
    const query = { select() { return query; }, eq() { return query; }, is() { return query; }, order() { return query; },
      async range(from: number) { return from ? { data: null, error: new Error('database unavailable') }
        : { data: Array.from({ length: 500 }, (_, i) => ({ id: String(i) })), error: null }; } };
    return query;
  } } as unknown as SupabaseClient;
  await assert.rejects(new SupabaseCartRepository(client).listByUser('owner'), /database unavailable/);
});
