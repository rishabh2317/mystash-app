import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { afterEach, mock, test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clearLiveProductPreviewMemoForTests } from '../pipeline/productLinkPreview';
import { CatalogService } from '../catalog/CatalogService';
import { InMemoryCatalogRepository } from '../catalog/InMemoryCatalogRepository';
import { MerchantEnrichmentService } from './enrichment/MerchantEnrichmentService';
import { TavilyMerchantExtractor } from './enrichment/TavilyMerchantExtractor';
import { getProductIntelligenceConfig } from './config';
import { ProductResolver, SupabaseDraftUpdater } from './resolver/ProductResolver';
import { TavilyEnrichedPdpSearchStrategy } from './search/TavilyEnrichedPdpSearchStrategy';
import { classifyPdp } from './search/PdpClassifier';
import { pdpSearchHintsAls } from './search/pdpSearchHints';

const originalFetch = global.fetch, originalTavily = process.env.TAVILY_API_KEY, originalOpenAi = process.env.OPENAI_API_KEY;
afterEach(() => { global.fetch = originalFetch; mock.restoreAll(); clearLiveProductPreviewMemoForTests(); if (originalTavily === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = originalTavily; if (originalOpenAi === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalOpenAi; });
const name = 'Lenovo ThinkPad X1 Carbon Gen 12 16GB RAM';
const merchantUrl = 'https://www.amazon.com/Lenovo-ThinkPad-X1-Carbon-Gen-12-16GB-RAM/dp/B000000001';
// Synthetic page fixtures exercise the actual scraper, enrichment and resolver.
// They are not represented as captured HTML from the two reported attempts.
function page(price: boolean) {
  return `<title>${name}</title>${price ? '<meta property="og:image" content="https://cdn.example/laptop.jpg">' : ''}<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name, brand: { name: 'Lenovo' }, model: 'X1 Carbon', sku: '21KC', ...(price ? { offers: { '@type': 'Offer', price: '1299', priceCurrency: 'USD' } } : {}) })}</script>`;
}
function transport(html: string, status = 200) {
  delete process.env.TAVILY_API_KEY;
  mock.method(dns, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);
  global.fetch = async () => new Response(html, { status });
}
function adminDouble(updates: Record<string, unknown>[] = []): SupabaseClient {
  const chain = { select() { return chain; }, eq() { return chain; }, maybeSingle: async () => ({ data: null, error: null }),
    upsert: async () => ({ error: null }), update(patch: Record<string, unknown>) { updates.push(patch); return chain; }, then(resolve: (value: unknown) => void) { resolve({ error: null }); } };
  return { from: () => chain } as unknown as SupabaseClient;
}
function resolver(url = merchantUrl) {
  const updates: Record<string, unknown>[] = [], db = adminDouble(updates), catalog = new InMemoryCatalogRepository();
  const search = new TavilyEnrichedPdpSearchStrategy({ name: 'fixture', search: async () => ({ kind: 'Succeeded', provider: 'fixture', candidates: [{ merchant: new URL(url).hostname, merchantUrl: url, title: name, image: null, score: 1 }] }) }, new MerchantEnrichmentService(new TavilyMerchantExtractor(db)), 'fixture-import', 'fixture-trace');
  return { catalog, updates, search, resolver: new ProductResolver(new CatalogService(catalog), search, new SupabaseDraftUpdater(db), { write: async () => {} }, { ...getProductIntelligenceConfig(), backgroundResolve: false }, null, 'fixture-import') };
}
const draft = { draftId: 'fixture-draft', externalId: 'fixture-product', name, brand: 'Lenovo', model: 'X1 Carbon', category: 'laptops', confidence: 1 };

for (const price of [false, true]) test(`Creator resolution persists a verified URL with ${price ? 'an available' : 'no'} price`, async () => {
  transport(page(price)); const system = resolver();
  const [result] = await system.resolver.resolveIngest([draft]);
  assert.equal(result.resolutionStatus, 'VERIFIED'); assert.equal(result.merchantUrl, merchantUrl);
  const saved = system.catalog.all()[0]; assert.equal(saved.preferredShoppingUrl, merchantUrl); assert.equal(saved.merchantUrl, merchantUrl);
  assert.equal(saved.price, price ? 'USD 1299' : null);
  assert.ok(system.updates.some(update => update.merchant_url === merchantUrl && update.resolution_status === 'VERIFIED'));
});

test('price-less pages gain PDP admission only with independent merchant evidence, not a lower threshold', async () => {
  transport(page(false));
  const metadata = await new MerchantEnrichmentService(new TavilyMerchantExtractor(adminDouble())).enrich({ merchantUrl, ingestId: 'fixture', traceId: 'fixture' });
  assert.equal(metadata.kind, 'ok'); if (metadata.kind !== 'ok') return;
  const m = metadata.metadata;
  const baseline = classifyPdp({ url: merchantUrl, title: m.title, metadata: { merchantProductMetadata: m.metadataCompleteness >= 35 } });
  const fixed = classifyPdp({ url: merchantUrl, title: m.title, metadata: { ...m.pageEvidence, merchantProductMetadata: m.metadataCompleteness >= 35 } });
  assert.ok(baseline.score < 0.45); assert.equal(baseline.verdict, 'uncertain');
  assert.ok(fixed.score >= 0.45); assert.equal(fixed.verdict, 'pdp'); assert.equal(m.price, null); assert.equal(m.image, null);
});

test('a previously verified price-less catalog destination survives unavailable scraping', async () => {
  transport(page(false)); const system = resolver(); await system.resolver.resolveIngest([draft]);
  global.fetch = async () => { throw Error('scraper unavailable'); };
  const [reused] = await system.resolver.resolveIngest([draft]);
  assert.equal(reused.resolutionStatus, 'VERIFIED'); assert.equal(reused.merchantUrl, merchantUrl);
});

test('Universal Find shares the price-optional merchant resolution without promoting the catalog', async () => {
  transport(page(false)); const system = resolver();
  const [result] = await system.resolver.resolveForUserImport([draft]);
  assert.equal(result.resolutionStatus, 'VERIFIED'); assert.equal(result.discovered?.merchantUrl, merchantUrl); assert.equal(result.discovered?.price, null);
  assert.equal(system.catalog.all().length, 0); assert.equal(system.updates.length, 0);
});

test('official shopping and retailer pages retain price-less structured evidence', async () => {
  transport(page(false));
  for (const url of ['https://www.lenovo.com/product/thinkpad-x1-carbon-gen12', 'https://www.bestbuy.com/product/lenovo-thinkpad-x1-carbon-gen12']) {
    const system = resolver(url); const [result] = await system.resolver.resolveIngest([draft]);
    assert.equal(result.resolutionStatus, 'VERIFIED', url); assert.equal(result.merchantUrl, url);
  }
});

test('failed scraping retains independently confirmed discovery without claiming page verification', async () => {
  transport('unavailable', 503); const system = resolver(); const [result] = await system.resolver.resolveIngest([draft]);
  assert.equal(result.resolutionStatus, 'VERIFIED'); assert.equal(result.merchantUrl, merchantUrl);
  const evidence = system.catalog.all()[0].metadata.merchant_evidence as Array<{ state: string }>;
  assert.equal(evidence[0]?.state, 'DISCOVERY_VERIFIED');
});

test('a price-less page remains useful when the Tavily fallback fails', async () => {
  transport(page(false)); process.env.TAVILY_API_KEY = 'fixture-not-a-real-key';
  const fetchPage = global.fetch; let providerCalls = 0;
  global.fetch = async (url, init) => String(url).includes('api.tavily.com') ? (providerCalls++, new Response('{}', { status: 503 })) : fetchPage(url, init);
  const system = resolver(); const [result] = await system.resolver.resolveIngest([draft]);
  assert.ok(providerCalls <= 3, 'fallback retry budget remains bounded'); assert.equal(result.resolutionStatus, 'VERIFIED'); assert.equal(result.merchantUrl, merchantUrl);
});

test('wrong configurations are rejected even when the merchant page has price and structured Product data', async () => {
  transport(page(true).replaceAll('Gen 12', 'Gen 11')); const system = resolver(); const [result] = await system.resolver.resolveIngest([draft]);
  assert.equal(result.resolutionStatus, 'UNVERIFIED'); assert.equal(result.merchantUrl, null);
});

test('recorded 0.41 Amazon outcomes stay rejected when independent page evidence is unavailable', async () => {
  // Exact persisted observations from Nov 9/10 logs: no price/image/specs, completeness 45;
  // these are deliberately not upgraded into invented Product schema evidence.
  for (const row of [
    { brand: 'Lenovo', name: 'Thinkpad X1 Carbon', model: 'X1 Carbon', context: '2026 Lenovo ThinkPad X1 Carbon #laptop', url: 'https://www.amazon.com/Lenovo-ThinkPad-i7-1365U-Fingerprint-Thunderbolt/dp/B0D8LKZXQX' },
    { brand: 'HP', name: 'Omnibook X', model: 'OmniBook X', context: 'HP OmniBook X - A 14” Snapdragon X Elite Laptop!', url: 'https://www.amazon.com/HP-OmniBook-Snapdragon-X1P-42-100-14-he0099nr/dp/B0F4GTHHCZ' },
  ]) {
    assert.equal(classifyPdp({ url: row.url, title: row.name, metadata: { merchantProductMetadata: true } }).score, 0.41);
    const strategy = new TavilyEnrichedPdpSearchStrategy({ name: 'recorded', search: async () => ({ kind: 'Succeeded', provider: 'recorded', candidates: [{ title: row.name, merchant: 'amazon.com', merchantUrl: row.url, image: null, score: 1 }] }) }, new MerchantEnrichmentService({ name: 'recorded', extract: async () => ({ title: row.name, brand: row.brand, merchantUrl: row.url, price: null, image: null, identitySource: 'merchant_html' }) }), 'recorded', 'recorded');
    const result = await pdpSearchHintsAls.run({ brand: row.brand, name: row.name, model: row.model, category: 'laptops', variantContext: row.context }, () => strategy.search(row.name));
    assert.equal(result.kind, 'Succeeded'); if (result.kind === 'Succeeded') assert.equal(result.candidates.length, 0);
  }
});

for (const evidence of ['product_schema', 'gpt_guess_only', 'different_url'] as const) test(`price-less Tavily recovery requires independent source facts: ${evidence}`, async () => {
  transport('', 503); process.env.TAVILY_API_KEY = 'fixture'; process.env.OPENAI_API_KEY = 'fixture';
  let calls = 0;
  global.fetch = async raw => {
    const url = String(raw); calls++;
    if (url.includes('api.tavily.com')) return Response.json({ results: [{ url: evidence === 'different_url' ? 'https://other.example/product/another' : merchantUrl, raw_content: evidence === 'gpt_guess_only' ? 'No product details available.' : page(false), images: [] }] });
    if (url.includes('api.openai.com')) return Response.json({ choices: [{ message: { content: JSON.stringify({ name, brand: 'Lenovo', price: null, imageUrl: '', currency: null }) } }] });
    return new Response('unavailable', { status: 503 });
  };
  const system = resolver(); const [result] = await system.resolver.resolveIngest([draft]);
  assert.ok(calls <= 3, 'one scrape and the existing Tavily/GPT fallback only');
  assert.equal(result.resolutionStatus, 'VERIFIED');
  assert.equal(result.merchantUrl, merchantUrl);
  const offers = system.catalog.all()[0].metadata.merchant_evidence as Array<{ state: string }>;
  assert.equal(offers[0]?.state, evidence === 'product_schema' ? 'PAGE_VERIFIED' : 'DISCOVERY_VERIFIED', 'GPT guesses never become page verification; the independent discovery fixture still confirms this exact model');
});
