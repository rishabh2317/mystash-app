import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CatalogService } from '../catalog/CatalogService';
import { InMemoryCatalogRepository } from '../catalog/InMemoryCatalogRepository';
import { ContentSourceService } from '../content-source/ContentSourceService';
import { InMemoryContentSourceRepository } from '../content-source/InMemoryContentSourceRepository';
import { DiscoveredProductService } from '../discovered/DiscoveredProductService';
import { InMemoryDiscoveredProductRepository } from '../discovered/InMemoryDiscoveredProductRepository';
import type { CatalogProduct } from '../product-intelligence/domain/types';
import { ProductPageService, ProductPageServiceError } from './ProductPageService';
import { emptyRelatedMediaPort } from './relatedMedia';
import type { ProductPageRelatedMedia } from './domain/types';

const CATALOG_ID = '550e8400-e29b-41d4-a716-446655440001';
const DISCOVERED_ID = '660e8400-e29b-41d4-a716-446655440001';

function baseProduct(
  partial: Partial<CatalogProduct> & Pick<CatalogProduct, 'id' | 'name' | 'status'>,
): CatalogProduct {
  return {
    canonicalSlug: `slug-${partial.id.slice(0, 8)}`,
    brand: 'Sony',
    normalizedName: partial.name.toLowerCase(),
    model: null,
    category: 'Audio',
    description: 'Noise-cancelling headphones.',
    imageUrl: 'https://cdn.example/headphones.jpg',
    merchant: 'Sony Store',
    merchantUrl: 'https://shop.example/headphones',
    preferredShoppingUrl: null,
    affiliateUrl: null,
    shoppingProvider: null,
    currency: 'USD',
    price: '299.00',
    verificationStatus: 'VERIFIED',
    verificationProvider: null,
    verificationSource: null,
    verificationVersion: null,
    lastVerifiedAt: '2026-09-01T00:00:00.000Z',
    aiConfidence: 0.9,
    matchConfidence: 0.8,
    verificationConfidence: 0.95,
    mergedIntoId: null,
    metadata: {
      specifications: { Driver: '30mm' },
      metadataCompleteness: 0.88,
    },
    ...partial,
  };
}

function createHarness(related: ProductPageRelatedMedia[] = []) {
  const catalogRepo = new InMemoryCatalogRepository();
  catalogRepo.seed(
    baseProduct({
      id: CATALOG_ID,
      name: 'WH-1000XM5',
      status: 'ACTIVE',
    }),
  );
  const catalog = new CatalogService(catalogRepo);

  const discoveredRepo = new InMemoryDiscoveredProductRepository();
  discoveredRepo.seed({
    id: DISCOVERED_ID,
    identityKey: 'n_importedmug0001',
    name: 'Ceramic mug',
    brand: 'Acme',
    model: null,
    category: 'Home',
    imageUrl: 'https://cdn.example/mug.jpg',
    price: '12.00',
    currency: 'USD',
    merchant: 'Acme Shop',
    merchantUrl: 'https://shop.example/mug',
    metadata: {},
    matchConfidence: 0.2,
    completeness: 0.3,
    processorVersion: 'test',
  });

  const sourceRepo = new InMemoryContentSourceRepository();
  const sources = new ContentSourceService(sourceRepo, {
    enqueue: async () => 'job',
  });

  const service = new ProductPageService(
    { resolveActiveProduct: (id) => catalog.resolveActiveProduct(id) },
    { getById: (id) => new DiscoveredProductService(discoveredRepo).getById(id) },
    {
      getById: (id) => sources.getById(id),
      listBoundSourceIds: (bind) => sourceRepo.listBoundSourceIds(bind),
    },
    {
      canShopCatalog: (product) => Boolean(product.merchantUrl || product.preferredShoppingUrl),
    },
    {
      listForCatalogProduct: async () => related,
      listMatchingUrls: async () => [],
    },
  );

  return { service, catalogRepo, discoveredRepo, sourceRepo };
}

async function bindSource(
  sourceRepo: InMemoryContentSourceRepository,
  input: {
    platform: 'youtube' | 'instagram' | 'web';
    externalId: string;
    canonicalUrl: string;
    catalogProductId?: string | null;
    discoveredProductId?: string | null;
  },
) {
  const created = await sourceRepo.insert({
    platform: input.platform,
    externalId: input.externalId,
    canonicalUrl: input.canonicalUrl,
    mediaKind: input.platform === 'web' ? 'WEB_PAGE' : 'VIDEO',
    processingStatus: 'READY',
    pipelineVersion: 'test',
  });
  await sourceRepo.replaceProducts(created.id, [
    {
      contentSourceId: created.id,
      position: 0,
      externalId: 'p1',
      name: 'Item',
      brand: null,
      model: null,
      category: null,
      price: null,
      currency: null,
      image: null,
      merchantUrl: null,
      confidence: null,
      extractionMethod: 'ai_extract',
      sources: [],
      evidence: {},
      processorVersion: 'test',
      catalogProductId: input.catalogProductId ?? null,
      discoveredProductId: input.discoveredProductId ?? null,
    },
  ]);
  return created;
}

describe('ProductPageService', () => {
  it('projects a canonical product without verification internals', async () => {
    const { service, catalogRepo } = createHarness();
    const before = catalogRepo.all().length;
    const page = await service.getPage(CATALOG_ID);
    assert.equal(page.productId, CATALOG_ID);
    assert.equal(page.shoppingProductId, CATALOG_ID);
    assert.equal(page.title, 'WH-1000XM5');
    assert.equal(page.brand, 'Sony');
    assert.equal(page.price, '299.00');
    assert.equal(page.canShop, true);
    assert.equal(page.offers[0]?.action, 'buy');
    assert.equal(page.specifications.Driver, '30mm');
    assert.equal(page.compareAvailable, true);
    const json = JSON.stringify(page);
    assert.equal(/verif|confidence|completeness|discovered|catalog[_ ]product|unverified/i.test(json), false);
    if (typeof before === 'number') assert.equal(catalogRepo.all().length, before);
  });

  it('projects a discovered product with merchant listing and no catalogue id', async () => {
    const { service } = createHarness();
    const page = await service.getPage(DISCOVERED_ID);
    assert.equal(page.productId, DISCOVERED_ID);
    assert.equal(page.shoppingProductId, null);
    assert.equal(page.title, 'Ceramic mug');
    assert.equal(page.merchant, 'Acme Shop');
    assert.equal(page.offers[0]?.action, 'listing');
    assert.equal(page.canShop, true);
    assert.equal(page.relatedMedia.length, 0);
    assert.equal(page.compareAvailable, true);
    const json = JSON.stringify(page);
    assert.equal(/confidence|completeness|discovered product|unverified/i.test(json), false);
  });

  it('attaches original source attribution from the requested content source', async () => {
    const { service, sourceRepo } = createHarness();
    const created = await sourceRepo.insert({
      platform: 'instagram',
      externalId: 'ABC123',
      canonicalUrl: 'https://www.instagram.com/reel/ABC123/',
      mediaKind: 'VIDEO',
      processingStatus: 'READY',
      pipelineVersion: 'test',
    });
    await sourceRepo.replaceProducts(created.id, [
      {
        contentSourceId: created.id,
        position: 0,
        externalId: 'p1',
        name: 'Ceramic mug',
        brand: 'Acme',
        model: null,
        category: 'Home',
        price: '12',
        currency: 'USD',
        image: null,
        merchantUrl: 'https://shop.example/mug',
        confidence: 0.4,
        extractionMethod: 'ai_extract',
        sources: [],
        evidence: {},
        processorVersion: 'test',
        discoveredProductId: DISCOVERED_ID,
      },
    ]);

    const page = await service.getPage(DISCOVERED_ID, {
      contentSourceId: created.id,
      userImportId: '880e8400-e29b-41d4-a716-446655440001',
    });
    assert.equal(page.source?.kind, 'reel');
    assert.equal(page.source?.label, 'Found from this Reel');
    assert.equal(page.source?.url, 'https://www.instagram.com/reel/ABC123/');
    assert.equal(page.source?.userImportId, '880e8400-e29b-41d4-a716-446655440001');
    assert.equal(page.source?.contentSourceId, created.id);
  });

  it('omits missing image, price, and media rather than inventing them', async () => {
    const catalogRepo = new InMemoryCatalogRepository();
    catalogRepo.seed(
      baseProduct({
        id: CATALOG_ID,
        name: 'Bare item',
        status: 'ACTIVE',
        imageUrl: null,
        price: null,
        currency: null,
        merchant: null,
        merchantUrl: null,
        description: null,
        metadata: {},
      }),
    );
    const catalog = new CatalogService(catalogRepo);
    const service = new ProductPageService(
      { resolveActiveProduct: (id) => catalog.resolveActiveProduct(id) },
      { getById: async () => null },
      {
        getById: async () => null,
        listBoundSourceIds: async () => [],
      },
      { canShopCatalog: () => false },
      emptyRelatedMediaPort,
    );
    const page = await service.getPage(CATALOG_ID);
    assert.equal(page.heroImage, null);
    assert.equal(page.price, null);
    assert.equal(page.source, null);
    assert.equal(page.relatedMedia.length, 0);
    assert.equal(page.canShop, false);
    assert.equal(page.offers.length, 0);
  });

  it('keeps related media off the original source URL', async () => {
    const sourceUrl = 'https://www.youtube.com/shorts/dQw4w9WgXcQ';
    const { service, sourceRepo } = createHarness([
      {
        id: 'rel-1',
        kind: 'short',
        label: 'YouTube Short',
        url: sourceUrl,
        title: 'Same short',
        thumbnailUrl: null,
        collectionId: 'col-1',
      },
      {
        id: 'rel-2',
        kind: 'reel',
        label: 'Instagram Reel',
        url: 'https://www.instagram.com/reel/OTHER/',
        title: 'Other reel',
        thumbnailUrl: null,
        collectionId: 'col-2',
      },
    ]);
    const created = await sourceRepo.insert({
      platform: 'youtube',
      externalId: 'dQw4w9WgXcQ',
      canonicalUrl: sourceUrl,
      mediaKind: 'VIDEO',
      processingStatus: 'READY',
      pipelineVersion: 'test',
    });
    const page = await service.getPage(CATALOG_ID, { contentSourceId: created.id });
    assert.equal(page.source?.kind, 'short');
    assert.deepEqual(
      page.relatedMedia.map((item) => item.id),
      ['rel-2'],
    );
  });

  it('prefers the explicit source and falls back to a bound source', async () => {
    const { service, sourceRepo } = createHarness();
    const first = await bindSource(sourceRepo, {
      platform: 'instagram',
      externalId: 'FIRST11',
      canonicalUrl: 'https://www.instagram.com/reel/FIRST11/',
      catalogProductId: CATALOG_ID,
    });
    const second = await bindSource(sourceRepo, {
      platform: 'youtube',
      externalId: 'dQw4w9WgXcQ',
      canonicalUrl: 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      catalogProductId: CATALOG_ID,
    });

    const fallback = await service.getPage(CATALOG_ID);
    assert.equal(fallback.source?.contentSourceId, first.id);

    const explicit = await service.getPage(CATALOG_ID, { contentSourceId: second.id });
    assert.equal(explicit.source?.contentSourceId, second.id);
    assert.ok(explicit.relatedMedia.some((item) => item.url.includes('FIRST11')));
    assert.equal(
      explicit.relatedMedia.some((item) => item.url.includes('dQw4w9WgXcQ')),
      false,
    );
  });

  it('drops duplicate and invalid related media', async () => {
    const { service } = createHarness([
      {
        id: 'dup-1',
        kind: 'short',
        label: 'YouTube Short',
        url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
        title: 'Short',
        thumbnailUrl: null,
        collectionId: 'col-1',
      },
      {
        id: 'dup-2',
        kind: 'short',
        label: 'YouTube Short',
        url: 'https://youtu.be/dQw4w9WgXcQ',
        title: 'Same video',
        thumbnailUrl: null,
        collectionId: 'col-2',
      },
      {
        id: 'bad',
        kind: 'page',
        label: 'Related page',
        url: 'javascript:alert(1)',
        title: 'Bad',
        thumbnailUrl: null,
        collectionId: null,
      },
    ]);
    const page = await service.getPage(CATALOG_ID);
    assert.deepEqual(
      page.relatedMedia.map((item) => item.id),
      ['dup-1'],
    );
  });

  it('hides media on a discovered product with no source relationship', async () => {
    const { service } = createHarness([
      {
        id: 'should-not-appear',
        kind: 'reel',
        label: 'Instagram Reel',
        url: 'https://www.instagram.com/reel/OTHER/',
        title: 'Other',
        thumbnailUrl: null,
        collectionId: 'col-9',
      },
    ]);
    const page = await service.getPage(DISCOVERED_ID);
    assert.equal(page.source, null);
    assert.equal(page.relatedMedia.length, 0);
  });

  it('projects multiple stored merchants without copying one price onto another', async () => {
    const catalogRepo = new InMemoryCatalogRepository();
    catalogRepo.seed(
      baseProduct({
        id: CATALOG_ID,
        name: 'WH-1000XM5',
        status: 'ACTIVE',
        price: '39990',
        currency: 'INR',
        merchant: 'Sony',
        merchantUrl: 'https://www.sony.com/headphones',
        metadata: {
          shopping_candidates: [
            {
              url: 'https://www.amazon.in/dp/XM5',
              merchant: 'Amazon',
              price: '34990',
              currency: 'INR',
            },
            {
              url: 'https://www.flipkart.com/sony-xm5/p/itm',
              merchant: 'Flipkart',
              price: '35499',
              currency: 'INR',
            },
            { url: 'https://www.sony.com/headphones', merchant: 'Sony' },
          ],
        },
      }),
    );
    const catalog = new CatalogService(catalogRepo);
    const service = new ProductPageService(
      { resolveActiveProduct: (id) => catalog.resolveActiveProduct(id) },
      { getById: async () => null },
      { getById: async () => null, listBoundSourceIds: async () => [] },
      { canShopCatalog: () => true },
      emptyRelatedMediaPort,
    );
    const page = await service.getPage(CATALOG_ID);
    assert.equal(page.offers.length, 3);
    assert.equal(page.price, null);
    assert.equal(page.offers[0]?.merchant, 'Amazon');
    assert.equal(page.offers[0]?.price, '34990');
    assert.equal(page.offers[1]?.merchant, 'Flipkart');
    assert.equal(page.offers[2]?.price, '39990');
    assert.ok(page.offers.every((offer) => offer.action === 'buy'));
    assert.equal(/verif|confidence|completeness|discovered/i.test(JSON.stringify(page)), false);
  });

  it('shows an unavailable merchant without a buying CTA', async () => {
    const catalogRepo = new InMemoryCatalogRepository();
    catalogRepo.seed(
      baseProduct({
        id: CATALOG_ID,
        name: 'Bare item',
        status: 'ACTIVE',
        merchantUrl: 'https://www.amazon.in/dp/XM5',
        merchant: 'Amazon',
        metadata: {
          offer: {
            merchant: 'Amazon',
            merchantUrl: 'https://www.amazon.in/dp/XM5',
            price: '34990',
            currency: 'INR',
            availability: 'OutOfStock',
          },
        },
      }),
    );
    const catalog = new CatalogService(catalogRepo);
    const service = new ProductPageService(
      { resolveActiveProduct: (id) => catalog.resolveActiveProduct(id) },
      { getById: async () => null },
      { getById: async () => null, listBoundSourceIds: async () => [] },
      { canShopCatalog: () => true },
      emptyRelatedMediaPort,
    );
    const page = await service.getPage(CATALOG_ID);
    assert.equal(page.offers[0]?.action, 'none');
    assert.equal(page.offers[0]?.availability, 'Out of stock');
  });

  it('does not invent a destination for a discovered product without a stored URL', async () => {
    const { discoveredRepo } = createHarness();
    discoveredRepo.seed({
      id: '770e8400-e29b-41d4-a716-446655440001',
      identityKey: 'n_nolink0001',
      name: 'Plain mug',
      brand: null,
      model: null,
      category: null,
      imageUrl: null,
      price: null,
      currency: null,
      merchant: 'Unknown shop',
      merchantUrl: null,
      metadata: {},
      matchConfidence: null,
      completeness: null,
      processorVersion: 'test',
    });
    const page = await new ProductPageService(
      { resolveActiveProduct: async () => null },
      { getById: (id) => new DiscoveredProductService(discoveredRepo).getById(id) },
      { getById: async () => null, listBoundSourceIds: async () => [] },
      { canShopCatalog: () => false },
      emptyRelatedMediaPort,
    ).getPage('770e8400-e29b-41d4-a716-446655440001');
    assert.equal(page.offers.some((offer) => offer.action !== 'none'), false);
    assert.equal(page.canShop, false);
    assert.equal(page.shoppingProductId, null);
  });

  it('projects a READY catalogue review and omits reviews when none exist', async () => {
    const withReview = new ProductPageService(
      { resolveActiveProduct: async () => baseProduct({ id: CATALOG_ID, name: 'WH-1000XM5', status: 'ACTIVE' }) },
      { getById: async () => null },
      { getById: async () => null, listBoundSourceIds: async () => [] },
      { canShopCatalog: () => true },
      emptyRelatedMediaPort,
      {
        findReady: async () => ({
          overview: 'Comfortable everyday headphones.',
          likes: ['Comfortable for long sessions'],
          concerns: ['Weaker isolation'],
          sources: [{ name: 'TechRadar', url: 'https://www.techradar.com/reviews/xm5' }],
          rating: null,
          reviewCount: null,
        }),
      },
    );
    const page = await withReview.getPage(CATALOG_ID);
    assert.equal(page.reviews?.overview, 'Comfortable everyday headphones.');
    assert.deepEqual(page.reviews?.likes, ['Comfortable for long sessions']);
    assert.equal(page.reviews?.rating, null);
    assert.equal(page.reviews?.reviewCount, null);
    assert.equal(/verif|confidence|generating|gemini/i.test(JSON.stringify(page.reviews)), false);

    const { service } = createHarness();
    const empty = await service.getPage(CATALOG_ID);
    assert.equal(empty.reviews, null);

    const discovered = await service.getPage(DISCOVERED_ID);
    assert.equal(discovered.reviews, null);
  });

  it('does not invent a product when the id is unknown', async () => {
    const { service } = createHarness();
    await assert.rejects(
      () => service.getPage('550e8400-e29b-41d4-a716-446655449999'),
      (err: unknown) => err instanceof ProductPageServiceError && err.statusCode === 404,
    );
  });
});
