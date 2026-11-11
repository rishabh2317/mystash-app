import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMerchantPageEvidence } from './merchantPageEvidence';
import { classifyPdp } from '../product-intelligence/search/PdpClassifier';
const url = 'https://www.amazon.com/product-name/dp/B000000001';
const schema = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

test('a Product schema without Offers retains price-independent PDP evidence', () => {
  const facts = readMerchantPageEvidence(schema({ '@type': 'Product', name: 'Lenovo ThinkPad X1 Carbon Gen 12', brand: { name: 'Lenovo' }, sku: 'SKU-12', model: 'X1 Carbon', mpn: '21KC', gtin13: '1234567890123' }), url);
  assert.equal(facts.hasProductJsonLd, true); assert.equal(facts.brand, 'Lenovo'); assert.equal(facts.model, 'X1 Carbon'); assert.equal(facts.mpn, '21KC'); assert.equal(facts.gtin, '1234567890123');
  assert.equal(classifyPdp({ url, title: facts.name, metadata: facts }).verdict, 'pdp');
});

test('product controls are evidence, but robots, arbitrary prose, malformed JSON and multiple unrelated Products are not', () => {
  assert.equal(readMerchantPageEvidence('<button id="add-to-cart">Buy</button>', url).hasAddToCart, true);
  for (const html of ['<p>We discuss add to cart buttons</p>', schema({ '@type': 'Product', url: 'https://other.example/product/a', name: 'Different item' }), schema([{ '@type': 'Product', name: 'A' }, { '@type': 'Product', name: 'B' }]), '<script type="application/ld+json">oops</script>', `<title>Robot Check</title>${schema({ '@type': 'Product', name: 'fake' })}`]) {
    const facts = readMerchantPageEvidence(html, url); assert.equal(facts.hasProductJsonLd, false); assert.equal(facts.hasAddToCart, false);
  }
});

test('schema cannot turn search, category, editorial, or invalid URLs into a shopping destination', () => {
  for (const bad of ['https://amazon.com/search?q=laptop','https://shop.example/category/laptops','https://shop.example/blog/product','javascript:alert(1)']) {
    const facts = readMerchantPageEvidence(schema({ '@type': 'Product', name: 'Lenovo Laptop', sku: '123' }), bad);
    assert.equal(classifyPdp({ url: bad, title: facts.name, metadata: facts }).verdict, 'not_pdp');
  }
});
