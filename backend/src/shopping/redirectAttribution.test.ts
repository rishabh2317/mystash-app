import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveRedirectAttribution } from './redirectAttribution';
function admin(collection: Record<string, unknown>, tags: unknown[]) {
  return { from(table: string) {
    const chain = { select: () => chain, eq: () => chain,
      maybeSingle: async () => ({ data: collection, error: null }),
      limit: async () => ({ data: tags, error: null }) };
    assert.ok(['collections', 'collection_product_tags'].includes(table));
    return chain;
  } } as unknown as SupabaseClient;
}
const input = { productId: 'product', collectionId: 'collection', tagId: 'tag', videoId: null, userId: null };
const published = { id: 'collection', creator_id: 'actual-owner', status: 'published', visibility: 'public', moderation_state: 'clear' };
describe('shopping redirect attribution', () => {
  it('uses the stored collection owner and verifies product membership', async () => {
    assert.deepEqual(await resolveRedirectAttribution(admin(published, [{ id: 'tag' }]), input), {
      collectionId: 'collection', creatorId: 'actual-owner', tagId: 'tag', videoId: null,
    });
  });
  it('drops attribution for an unrelated product without blocking a destination', async () => {
    const result = await resolveRedirectAttribution(admin(published, []), input);
    assert.equal(result.creatorId, null);
    assert.equal(result.collectionId, null);
  });
  it('does not attribute private collections to anonymous users', async () => {
    const result = await resolveRedirectAttribution(admin({ ...published, visibility: 'private' }, [{ id: 'tag' }]), input);
    assert.equal(result.creatorId, null);
  });
});
