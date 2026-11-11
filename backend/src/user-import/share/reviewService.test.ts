import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createShareReviewService } from './reviewService';
import { assessSimilar } from './similarity';
import { assessFindMatches } from './findMatches';
import { ShareError } from './contracts';
const source = '11111111-1111-4111-8111-111111111111', imported = '22222222-2222-4222-8222-222222222222', catalog = '33333333-3333-4333-8333-333333333333';
function fixture(state = 'accepting', changed = false, possible = false) {
  const product = { id: source, name: 'Brown leather handbag', brand: null, model: null, category: 'Bags', confidence: 0.95,
    catalog_product_id: null, discovered_product_id: null,
    ...(possible ? { name: 'Blue denim jacket', category: 'fashion', evidence: { identification: { kind: 'possible' } } } : {}) };
  const merchantUrl = possible ? 'https://www.shop.example/products/blue-denim-jacket' : 'https://www.shop.example/products/brown-leather-handbag';
  const assessment = (possible ? assessFindMatches : assessSimilar)(product, [{ title: product.name, brand: null, model: null, category: product.category, image: null,
    merchantUrl, merchant: 'Shop', score: 1, pdpVerdict: 'pdp', pdpScore: 1, sourceTier: 'retailer', verifiedCatalogId: catalog }]);
  assert.equal(assessment.suggestions.length, 1);
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db = { from(table: string) {
    assert.ok(['user_imports','content_source_products','catalog_products'].includes(table));
    const value = table === 'user_imports' ? { id: imported, content_source_id: 'content', interest_kind: null, interest_note: null }
      : table === 'content_source_products' ? { ...product, match_assessment: assessment }
      : { ...product, image_url: null, merchant_url: changed ? 'https://changed.invalid/products/other' : merchantUrl, verification_status: 'VERIFIED' };
    const query = { select() { return query; }, eq() { return query; }, is() { return query; }, maybeSingle: async () => ({ data: value, error: null }) }; return query;
  }, async rpc(name: string, args: Record<string, unknown>) {
    calls.push({ name, args }); return { data: name === 'share_review_claim' ? { state, productId: catalog } : { state: 'accepted', productId: catalog }, error: null };
  } } as unknown as SupabaseClient;
  return { service: createShareReviewService(db), key: assessment.suggestions[0].key, calls };
}
test('existing suggestion validation feeds the atomic receipt/membership transaction', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.decide('owner', imported, { sourceProductId: source, candidateKey: f.key, action: 'save' }), { state: 'accepted', productId: catalog });
  assert.deepEqual(f.calls.map(call => call.name), ['share_review_claim','find_accept_suggestion']);
  assert.equal(f.calls[1].args.p_lease, f.calls[0].args.p_lease); assert.equal(f.calls[1].args.p_catalog, catalog);
  assert.equal(f.calls[1].args.p_user, 'owner');
});
test('possible-style Save uses the existing owner-scoped lease and atomic membership receipt', async () => {
  const f = fixture('accepting', false, true);
  assert.equal(f.calls.length, 0, 'assessment does not save anything');
  await f.service.decide('owner', imported, { sourceProductId: source, candidateKey: f.key, action: 'save' });
  assert.deepEqual(f.calls.map(c => c.name), ['share_review_claim','find_accept_suggestion']);
  assert.equal(f.calls[1].args.p_user, 'owner');
});
test('receipt replay and dismissal do not repeat membership writes', async () => {
  for (const [state, action] of [['accepted','save'],['dismissed','dismiss']] as const) {
    const f = fixture(state); await f.service.decide('owner', imported, { sourceProductId: source, candidateKey: f.key, action });
    assert.deepEqual(f.calls.map(call => call.name), ['share_review_claim']);
  }
});
test('changed merchant evidence fails validation before membership finalization', async () => {
  const f = fixture('accepting', true);
  await assert.rejects(f.service.decide('owner', imported, { sourceProductId: source, candidateKey: f.key, action: 'save' }), (e: unknown) => e instanceof ShareError && e.status === 409);
  assert.deepEqual(f.calls.map(call => call.name), ['share_review_claim']);
});
