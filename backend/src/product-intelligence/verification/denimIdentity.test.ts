import assert from 'node:assert/strict';
import { it } from 'node:test';
import { qualifyMerchantEvidence, assessMerchantIdentity } from './merchantEvidence';
import { assessProductIdentityCompatibility } from '../search/productIdentityCompatibility';
import { buildProductSearchQuery } from '../search/ProductSearchQueryBuilder';
import { ProductNormalizer } from '../normalizer/ProductNormalizer';

export const denimIdentities = [
  { name: 'UNIQLO Denim Trucker Jacket', brand: 'UNIQLO', model: '484402',
    title: 'Unisex Denim Trucker Jacket', url: 'https://www.uniqlo.com/us/en/products/E484402-000/00', before: 'model_missing' },
  { name: "Levi's Relaxed Fit Trucker Jacket", brand: "Levi's", model: 'A57820104',
    title: 'Relaxed Trucker Jacket - Dark Wash', url: 'https://www.levi.com/US/en_US/clothing/men/outerwear/relaxed-trucker-jacket/p/A57820104', before: 'brand_conflict' },
];
for (const item of denimIdentities) it(`recorded discovery: ${item.brand} SKU survives merchant-only normalization`, () => {
  const expected = { ...item, category: 'fashion' };
  const candidate = { title: item.title, merchantUrl: item.url };
  assert.equal(assessProductIdentityCompatibility(expected, candidate).reason, item.before, 'legacy image gate remains frozen');
  assert.equal(assessMerchantIdentity(expected, candidate).ok, true);
  const outcome = qualifyMerchantEvidence(expected, { url: item.url, discovery: { title: item.title, provider: 'recorded-serper' }, pageRead: 'UNAVAILABLE' });
  assert.equal(outcome.state, 'DISCOVERY_VERIFIED');
  assert.equal(outcome.url, item.url, 'actual destination is never rewritten');
  assert.equal(outcome.origin, 'independent_discovery');
  const draft = { ...expected, draftId: 'denim', externalId: 'denim', confidence: 1 };
  const normalized = new ProductNormalizer().normalize(draft);
  assert.ok(buildProductSearchQuery(draft, normalized, { merchantOnly: true }).query.includes(item.model));
});
it('wrong SKU, misleading domains, type conflicts and conflicting page evidence remain ineligible', () => {
  const item = denimIdentities[0]!;
  for (const url of [item.url.replace('484402','484403'),item.url.replace('uniqlo.com','uniqlo.com.evil.example')]) {
    assert.equal(qualifyMerchantEvidence(item, { url, discovery: { title: item.title, provider: 'fixture' }, pageRead: 'UNAVAILABLE' }).usable, false);
  }
  const levi = denimIdentities[1]!;
  assert.equal(qualifyMerchantEvidence(levi, { url: levi.url, discovery: { title: levi.title, provider: 'fixture' }, pageRead: 'READ', page: { title: "Levi's jacket A57820103", brand: "Levi's", model: 'A57820103' } }).usable, false);
  assert.equal(assessMerchantIdentity(item, { title: 'UNIQLO Denim Jeans 484402', merchantUrl: item.url }).ok, false);
});
it('image search query is byte-for-byte unchanged while the merchant query preserves Levi SKU', () => {
  const item = denimIdentities[1]!;
  const draft = { ...item, draftId: 'denim', externalId: 'denim', confidence: 1 };
  const norm = new ProductNormalizer().normalize(draft);
  assert.equal(buildProductSearchQuery(draft,norm).query, 'Levi s Relaxed Fit Trucker Jacket');
  assert.match(buildProductSearchQuery(draft,norm,{merchantOnly:true}).query,/A57820104/);
});

it('UNIQLO typed source and page SKU aliases preserve all identity digits',()=>{
  const item=denimIdentities[0]!;
  assert.equal(qualifyMerchantEvidence({...item,model:'E484402'},{url:item.url,discovery:{title:item.title,provider:'fixture'},pageRead:'UNAVAILABLE'}).usable,true);
  assert.equal(assessMerchantIdentity({...item,model:'484402'},{title:item.title,brand:'UNIQLO',model:'E484402'}).ok,true);
  assert.equal(assessMerchantIdentity({...item,model:'484402'},{title:item.title,brand:'UNIQLO',model:'E484403'}).ok,false);
});
