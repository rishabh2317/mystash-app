import assert from 'node:assert/strict';
import { it } from 'node:test';
import { CatalogService } from '../../catalog/CatalogService';
import { InMemoryCatalogRepository } from '../../catalog/InMemoryCatalogRepository';
import { ProductPageService } from '../../product-page/ProductPageService';
import { emptyRelatedMediaPort } from '../../product-page/relatedMedia';
import { buildVideoProductInserts } from '../../publishVideoProjection';
import { catalogShoppingSource, listStoredShoppingDestinations } from '../../shopping/storedDestinations';
import { getProductIntelligenceConfig } from '../config';
import type { DraftUpdater } from '../interfaces/CatalogRepository';
import { MerchantEnrichmentService } from '../enrichment/MerchantEnrichmentService';
import { pdpSearchHintsAls } from '../search/pdpSearchHints';
import { TavilyEnrichedPdpSearchStrategy } from '../search/TavilyEnrichedPdpSearchStrategy';
import fixture from '../search/testing/creatorBatCandidates.json';
import { ProductResolver } from './ProductResolver';

it('repairs the recorded identity miss within the existing search/enrichment budget and preserves the catalog ID through Buy publication', async () => {
  const repo = new InMemoryCatalogRepository();
  const catalog = new CatalogService(repo);
  const original = await catalog.createFromResolve({
    canonicalSlug: 'sg-kungfu-pandya-bat', normalizedName: 'kungfu pandya bat', ...fixture.expected,
    price: '70000', currency: 'INR', verificationStatus: 'UNVERIFIED',
    verificationSource: 'ai_fallback', verificationVersion: 'v1', metadata: {},
  });
  const queries: string[] = [], enriched: string[] = [];
  const strategy = new TavilyEnrichedPdpSearchStrategy({ name: 'recorded-serper', async search(query) {
    queries.push(query);
    return { kind: 'Succeeded', provider: 'recorded-serper', candidates: queries.length === 1 ? fixture.candidates : [] };
  } }, new MerchantEnrichmentService({ name: 'synthetic-merchant-fixture', async extract(input) {
    // The discovery hits are recorded. Merchant responses are synthetic unit fixtures:
    // this test does not assert that today's live merchant pages are purchasable.
    enriched.push(input.merchantUrl);
    const candidate = fixture.candidates.find(c => c.merchantUrl === input.merchantUrl)!;
    return { title: candidate.title, brand: 'SG', category: 'sports', price: '70000', currency: 'INR',
      merchantUrl: candidate.merchantUrl, merchant: candidate.merchant,
      image: 'https://fixture.invalid/bat.jpg', description: 'English willow cricket bat.',
      specifications: { Material: 'English willow' }, identitySource: 'merchant_html' };
  } }), 'ingest-fixture', 'trace-fixture', 5);
  const writes: Parameters<DraftUpdater['updateResolution']>[0][] = [];
  const resolver = new ProductResolver(catalog, strategy, { async updateResolution(update) { writes.push(update); } },
    { async write() {} }, { ...getProductIntelligenceConfig(), enabled: true, backgroundResolve: false }, null, 'ingest-fixture');
  const [result] = await pdpSearchHintsAls.run(fixture.expected, () => resolver.resolveIngest([{
    draftId: 'draft-fixture', externalId: 'same-external-id', catalogProductId: original.id,
    ...fixture.expected, confidence: 1, price: '70000', currency: 'INR',
  }]));
  assert.equal(queries.length, 3, 'existing base + official + Amazon discovery budget');
  assert.equal(enriched.length, 3, 'only the already discovered hits are enriched');
  assert.equal(new Set(enriched).size, 3);
  assert.equal(repo.all().length, 1, 'repair updates the original catalog product');
  assert.equal(result.catalogProductId, original.id);
  assert.equal(writes[0].catalogProductId, original.id);
  assert.ok(result.merchantUrl);
  const product = (await catalog.getById(original.id))!;
  const destinations = listStoredShoppingDestinations(catalogShoppingSource(product));
  assert.ok(destinations.length > 0);
  const projection = buildVideoProductInserts('existing-video-id', [{ name: product.name, price: product.price ?? '—',
    image: product.imageUrl ?? '', merchant_url: product.merchantUrl, affiliate_url: null,
    provider: product.merchant ?? '', sort_order: 0, catalog_product_id: product.id, resolution_status: product.verificationStatus }]);
  assert.equal(projection[0].video_id, 'existing-video-id');
  assert.equal(projection[0].catalog_product_id, original.id);
  assert.equal(projection[0].merchant_url, result.merchantUrl);
  const pageService = new ProductPageService({ resolveActiveProduct: id => catalog.resolveActiveProduct(id) },
    { getById: async () => null }, { getById: async () => null, listBoundSourceIds: async () => [] },
    { canShopCatalog: () => destinations.length > 0 }, emptyRelatedMediaPort);
  const page = await pageService.getPage(original.id);
  assert.equal(page.productId, original.id);
  assert.equal(page.canShop, true);
  assert.ok(page.offers.some(o => o.action === 'buy'));
  assert.ok(page.offers.every(o => !('url' in o)), 'Buy continues to use server-issued offer IDs');
});
