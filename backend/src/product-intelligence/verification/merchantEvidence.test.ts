import assert from 'node:assert/strict';
import { it } from 'node:test';
import { qualifyMerchantEvidence as qualify, assessMerchantIdentity } from './merchantEvidence';
const expected = { name: 'JBL Tune Beam 2', brand: 'JBL', model: 'Tune Beam 2', category: 'electronics' };
const url = 'https://www.jbl.com/TUNE-BEAM-2.html';
const discovery = { title: 'JBL Tune Beam 2 | Noise Cancelling Earbuds', provider: 'recorded-search' };
it('distinguishes page, discovery, unresolved, and rejected evidence without prices or rank', () => {
  assert.equal(qualify(expected, { url, discovery, pageRead: 'READ', page: { title: discovery.title, brand: 'JBL' } }).state, 'PAGE_VERIFIED');
  assert.equal(qualify(expected, { url, discovery, pageRead: 'UNAVAILABLE' }).state, 'DISCOVERY_VERIFIED');
  assert.equal(qualify(expected, { url, pageRead: 'UNAVAILABLE' }).state, 'UNRESOLVED');
  const wrong = qualify(expected, { url: 'https://www.jbl.com/TUNE-BEAM.html', discovery: { ...discovery, title: 'JBL Tune Beam | Earbuds' }, pageRead: 'UNAVAILABLE' });
  assert.equal(wrong.state, 'REJECTED');
});
it('missing model evidence stays unresolved and an unreadable page is not a mismatch', () => {
  assert.equal(qualify(expected, { url: 'https://www.amazon.in/dp/B0DK3W2XK3', discovery: { ...discovery, title: 'JBL headphones' }, pageRead: 'UNAVAILABLE' }).state, 'UNRESOLVED');
});
it('page contradictions override matching discovery and prices never prove identity', () => {
  assert.equal(qualify(expected, { url, discovery, pageRead: 'READ', page: { title: 'JBL Tune Beam 3', brand: 'JBL' } }).state, 'REJECTED');
  assert.equal(qualify(expected, { url, discovery, pageRead: 'READ', page: { title: 'JBL headphones' } }).state, 'UNRESOLVED');
});
it('rejects unsafe hosts, credentials, redirects, search/category pages and lookalike merchants', () => {
  for (const bad of ['http://127.0.0.1/p/beam', 'http://169.254.169.254/p/beam', 'https://user:pass@jbl.com/TUNE-BEAM-2.html', 'https://jbl.com/p/beam?redirect=https://evil.com', 'https://amazon.in/jbl/s?k=jbl', 'https://jbl.com/collections/earbuds']) {
    assert.equal(qualify(expected, { url: bad, discovery, pageRead: 'UNAVAILABLE' }).state, 'REJECTED', bad);
  }
  assert.equal(qualify(expected, { url: 'https://jbl.evil.example/product/tune-beam-2', discovery, pageRead: 'UNAVAILABLE' }).usable, false);
});
it('strict numeric merchant matching does not alter the image identity gate', () => {
  assert.equal(assessMerchantIdentity(expected, { title: 'JBL Tune Beam', merchantUrl: 'https://jbl.com/TUNE-BEAM.html' }).ok, false);
  assert.equal(assessMerchantIdentity({ brand: 'DJI', name: 'Osmo Pocket 3', model: 'Pocket 3' }, { title: 'DJI Osmo Pocket 3', merchantUrl: 'https://store.dji.com/product/osmo-pocket-3' }).ok, true);
});
it('recorded laptop variants remain unresolved when required page facts are missing', () => {
  for (const laptop of [
    { name: 'HP OmniBook X', brand: 'HP', model: 'OmniBook X', variantContext: 'Snapdragon X Elite', url: 'https://www.hp.com/us-en/shop/pdp/hp-omnibook-x-laptop-ai-pc-14-fe000-14-9j1h6av-1' },
    { name: 'ThinkPad X1 Carbon', brand: 'Lenovo', model: 'X1 Carbon', variantContext: '2026 laptop', url: 'https://www.lenovo.com/us/en/p/laptops/thinkpad/thinkpadx1/lenovo-thinkpad-x1-carbon-gen-14-aura-edition-14-inch-intel/len101t0159' },
  ]) assert.equal(qualify(laptop, { url: laptop.url, discovery: { title: laptop.name, provider: 'recorded' }, pageRead: 'UNAVAILABLE' }).state, 'UNRESOLVED');
});

it('one offer cannot borrow another offer’s page evidence or discovery score', async () => {
  const { qualifyMerchantEvidenceSet } = await import('./merchantEvidence');
  const good = { url, discovery, pageRead: 'READ' as const, page: { title: discovery.title, brand: 'JBL' } };
  const bad = { url: 'https://www.amazon.in/dp/B0OTHER', pageRead: 'UNAVAILABLE' as const };
  const rows = qualifyMerchantEvidenceSet(expected, [good, bad]);
  assert.equal(rows[0].state, 'PAGE_VERIFIED');
  assert.equal(rows[1].state, 'UNRESOLVED');
});
it('duplicate discovery cannot override a contradictory or incomplete fetched page, including tracking aliases', async () => {
  const { qualifyMerchantEvidenceSet } = await import('./merchantEvidence');
  for (const title of ['JBL Tune Beam 3', 'JBL headphones']) {
    const rows = qualifyMerchantEvidenceSet(expected, [
      { url, discovery, pageRead: 'READ', page: { title, brand: 'JBL' } },
      { url: url + '?utm_source=other-search', discovery, pageRead: 'NOT_ATTEMPTED' },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, title.includes('3') ? 'REJECTED' : 'UNRESOLVED');
  }
});
it('versioned destination projection cannot resurrect unresolved/rejected URLs from stale or configured fields', async () => {
  const { listStoredShoppingDestinations } = await import('../../shopping/storedDestinations');
  const rows = listStoredShoppingDestinations({ brand: 'JBL', merchant: 'JBL', merchantUrl: 'https://jbl.com/TUNE-BEAM.html',
    preferredShoppingUrl: url, price: null, currency: null,
    metadata: { merchant_evidence_version: 'merchant-evidence-v1', merchant_evidence: [
      qualify(expected, { url, discovery, pageRead: 'UNAVAILABLE' }),
      qualify(expected, { url: 'https://jbl.com/TUNE-BEAM.html', discovery: { ...discovery, title: 'JBL Tune Beam' }, pageRead: 'UNAVAILABLE' }),
    ], shopping_candidates: [{ url }, { url: 'https://jbl.com/TUNE-BEAM.html' }],
      offer: { merchantUrl: 'https://jbl.com/TUNE-BEAM.html', price: '99' } } });
  assert.deepEqual(rows.map(r => r.url), [url]);
});
it('private-image contexts retain the stronger independent merchant-page requirement', async () => {
  const { qualifyMerchantEvidenceSet } = await import('./merchantEvidence');
  const [offer] = qualifyMerchantEvidenceSet(expected, [{ url, discovery, pageRead: 'UNAVAILABLE' }], { requirePage: true });
  assert.equal(offer.state, 'UNRESOLVED');
  assert.equal(offer.usable, false);
});
it('a warranty number cannot disguise a contradictory product generation', () => {
  assert.equal(qualify(expected, { url, pageRead: 'READ', page: { title: 'JBL Tune Beam 3 with 2 year warranty', brand: 'JBL' } }).state, 'REJECTED');
});
it('missing identifiers are unresolved while independently conflicting identifiers are rejected', () => {
  const product = { ...expected, gtin: '1234567890123' };
  assert.equal(qualify(product, { url, pageRead: 'READ', page: { title: discovery.title, brand: 'JBL' } }).state, 'UNRESOLVED');
  assert.equal(qualify(product, { url, pageRead: 'READ', page: { title: discovery.title, brand: 'JBL', gtin: '9999999999999' } }).state, 'REJECTED');
});
it('an original-generation page cannot qualify by borrowing a new-generation URL or schema hint', () => {
  assert.equal(qualify(expected, { url: 'https://jbl.com/TUNE-BEAM.html', pageRead: 'READ', page: { title: 'JBL Tune Beam', brand: 'JBL' } }).state, 'REJECTED');
});
