import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CatalogService } from '../../catalog/CatalogService';
import { InMemoryCatalogRepository } from '../../catalog/InMemoryCatalogRepository';
import { CartService } from '../../cart/CartService';
import { InMemoryCartRepository } from '../../cart/InMemoryCartRepository';
import type { CatalogCartPort, DiscoveredCartPort } from '../../cart/ports';
import { DiscoveredProductService } from '../../discovered/DiscoveredProductService';
import { InMemoryDiscoveredProductRepository } from '../../discovered/InMemoryDiscoveredProductRepository';
import { getProductIntelligenceConfig } from '../../product-intelligence/config';
import type { CatalogProduct, SearchResult } from '../../product-intelligence/domain/types';
import { ProductResolver } from '../../product-intelligence/resolver/ProductResolver';
import { InMemoryContentSourceRepository } from '../InMemoryContentSourceRepository';
import { InMemoryUserImportRepository } from '../../user-import/InMemoryUserImportRepository';
import type { InsertContentSourceProductRow } from '../domain/types';
import { ContentSourceResolutionService } from './ContentSourceResolutionService';

const CATALOG_XM5 = '550e8400-e29b-41d4-a716-446655440201';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

function catalogProduct(
  partial: Partial<CatalogProduct> & Pick<CatalogProduct, 'id' | 'name'>,
): CatalogProduct {
  return {
    canonicalSlug: partial.canonicalSlug ?? `slug-${partial.id.slice(0, 8)}`,
    brand: partial.brand ?? 'Sony',
    normalizedName: partial.normalizedName ?? partial.name.toLowerCase(),
    model: partial.model ?? 'WH-1000XM5',
    category: partial.category ?? 'headphones',
    description: partial.description ?? null,
    imageUrl: partial.imageUrl ?? null,
    merchant: partial.merchant ?? 'Shop',
    merchantUrl: partial.merchantUrl ?? 'https://shop.example/xm5',
    preferredShoppingUrl: partial.preferredShoppingUrl ?? 'https://shop.example/xm5',
    affiliateUrl: partial.affiliateUrl ?? null,
    shoppingProvider: partial.shoppingProvider ?? 'merchant',
    currency: partial.currency ?? 'USD',
    price: partial.price ?? '300',
    status: partial.status ?? 'ACTIVE',
    verificationStatus: partial.verificationStatus ?? 'VERIFIED',
    verificationProvider: partial.verificationProvider ?? 'catalog',
    verificationSource: partial.verificationSource ?? 'catalog',
    verificationVersion: partial.verificationVersion ?? 'v1',
    lastVerifiedAt: partial.lastVerifiedAt ?? new Date().toISOString(),
    aiConfidence: partial.aiConfidence ?? 0.9,
    matchConfidence: partial.matchConfidence ?? 0.9,
    verificationConfidence: partial.verificationConfidence ?? 0.9,
    mergedIntoId: partial.mergedIntoId ?? null,
    metadata: partial.metadata ?? {},
    ...partial,
  };
}

function candidate(
  contentSourceId: string,
  partial: Partial<InsertContentSourceProductRow> & { name: string; externalId: string; position: number },
): InsertContentSourceProductRow {
  return {
    contentSourceId,
    brand: partial.brand ?? null,
    model: partial.model ?? null,
    category: partial.category ?? 'headphones',
    price: partial.price ?? null,
    currency: partial.currency ?? null,
    image: partial.image ?? null,
    merchantUrl: partial.merchantUrl ?? null,
    confidence: partial.confidence ?? 0.9,
    extractionMethod: partial.extractionMethod ?? 'ai_extract',
    sources: partial.sources ?? ['METADATA'],
    evidence: partial.evidence ?? { sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    processorVersion: partial.processorVersion ?? 'test',
    ...partial,
  };
}

async function insertSource(repo: InMemoryContentSourceRepository, externalId: string) {
  return repo.insert({
    platform: 'youtube',
    externalId,
    canonicalUrl: `https://www.youtube.com/watch?v=${externalId}`,
    mediaKind: 'VIDEO',
    processingStatus: 'PROCESSING',
    pipelineVersion: 'test',
  });
}

async function addImport(
  imports: InMemoryUserImportRepository,
  userId: string,
  contentSourceId: string,
  url: string,
) {
  return imports.insert({
    userId,
    rawInput: url,
    sourceUrl: url,
    normalizedUrl: url,
    dedupeKey: `${userId}:${url}`,
    platform: 'youtube',
    contentSourceId,
    status: 'RECEIVED',
  });
}

function createHarness() {
  const catalogRepo = new InMemoryCatalogRepository();
  catalogRepo.seed(
    catalogProduct({
      id: CATALOG_XM5,
      name: 'Sony WH-1000XM5',
      normalizedName: 'sony wh 1000xm5',
    }),
  );
  const catalog = new CatalogService(catalogRepo);
  const discoveredRepo = new InMemoryDiscoveredProductRepository();
  const discovered = new DiscoveredProductService(discoveredRepo);
  const cartRepo = new InMemoryCartRepository();
  const catalogPort: CatalogCartPort = {
    resolveActiveProduct: (id) => catalog.resolveActiveProduct(id),
    getById: (id) => catalog.getById(id),
    async getProductsByIds(ids) {
      const map = new Map<string, CatalogProduct>();
      for (const id of ids) {
        const p = await catalog.getById(id);
        if (p) map.set(id, p);
      }
      return map;
    },
  };
  const discoveredPort: DiscoveredCartPort = { getById: (id) => discovered.getById(id) };
  const cart = new CartService(cartRepo, catalogPort, discoveredPort);

  let searched = 0;
  const resolver = new ProductResolver(
    catalog,
    {
      async search(): Promise<SearchResult> {
        searched += 1;
        return { kind: 'Succeeded', provider: 'mock', candidates: [] };
      },
    },
    { async updateResolution() {} },
    { async write() {} },
    { ...getProductIntelligenceConfig(), enabled: true, backgroundResolve: false },
    null,
    'content-source',
  );

  const sources = new InMemoryContentSourceRepository();
  const imports = new InMemoryUserImportRepository();
  const service = new ContentSourceResolutionService(
    sources,
    discovered,
    { resolveForUserImport: (drafts) => resolver.resolveForUserImport(drafts) },
    {
      listByContentSourceId: async (id) =>
        (await imports.listByContentSourceId(id)).map((row) => ({ id: row.id, userId: row.userId })),
    },
    cart,
  );

  return {
    service,
    sources,
    imports,
    catalogRepo,
    discoveredRepo,
    cart,
    searched: () => searched,
  };
}

describe('ContentSourceResolutionService', () => {
  it('binds a catalogue hit to catalog_products and fans into each user Bag', async () => {
    const harness = createHarness();
    const source = await insertSource(harness.sources, 'hitVideo');
    await harness.sources.replaceProducts(source.id, [
      candidate(source.id, {
        position: 1,
        externalId: 'p1',
        name: 'Sony WH-1000XM5',
        brand: 'Sony',
        model: 'WH-1000XM5',
        merchantUrl: 'https://shop.example/xm5',
      }),
    ]);
    const importA = await addImport(harness.imports, USER_A, source.id, source.canonicalUrl);
    const importB = await addImport(harness.imports, USER_B, source.id, source.canonicalUrl);

    await harness.service.resolveAndFanOut(source.id);

    const products = await harness.sources.listProducts(source.id);
    assert.equal(products.length, 1);
    assert.equal(products[0]?.catalogProductId, CATALOG_XM5);
    assert.equal(products[0]?.discoveredProductId, null);
    assert.equal(harness.catalogRepo.all().length, 1);
    assert.equal(harness.discoveredRepo.products.size, 0);

    const bagA = await harness.cart.getCart(USER_A);
    const bagB = await harness.cart.getCart(USER_B);
    assert.equal(bagA.itemCount, 1);
    assert.equal(bagB.itemCount, 1);
    assert.equal(bagA.items[0]?.catalogProductId, CATALOG_XM5);
    assert.equal(bagA.items[0]?.source?.contentSourceId, source.id);
    assert.equal(bagA.items[0]?.source?.userImportId, importA.id);
    assert.equal(bagB.items[0]?.source?.userImportId, importB.id);
    assert.equal(bagA.items[0]?.source?.surface, 'USER_IMPORT');
  });

  it('creates discovered_products only on a catalogue miss', async () => {
    const harness = createHarness();
    const beforeCatalog = harness.catalogRepo.all().length;
    const source = await insertSource(harness.sources, 'missVideo');
    await harness.sources.replaceProducts(source.id, [
      candidate(source.id, {
        position: 1,
        externalId: 'p1',
        name: 'Mystery Gadget',
        brand: 'Acme',
        model: 'GX1',
        category: 'gadgets',
      }),
    ]);
    await addImport(harness.imports, USER_A, source.id, source.canonicalUrl);

    await harness.service.resolveAndFanOut(source.id);

    const products = await harness.sources.listProducts(source.id);
    assert.equal(products[0]?.catalogProductId, null);
    assert.ok(products[0]?.discoveredProductId);
    assert.equal(harness.catalogRepo.all().length, beforeCatalog);
    assert.equal(harness.discoveredRepo.products.size, 1);
    const bag = await harness.cart.getCart(USER_A);
    assert.equal(bag.itemCount, 1);
    assert.equal(bag.items[0]?.discoveredProductId, products[0]?.discoveredProductId);
    assert.equal(bag.items[0]?.catalogProductId, null);
    assert.doesNotMatch(JSON.stringify(bag.items[0]?.product), /discovered/i);
  });

  it('reuses one discovered product across users with the same identity', async () => {
    const harness = createHarness();
    const source = await insertSource(harness.sources, 'reuseVideo');
    await harness.sources.replaceProducts(source.id, [
      candidate(source.id, {
        position: 1,
        externalId: 'p1',
        name: 'Mystery Gadget',
        brand: 'Acme',
        model: 'GX1',
        category: 'gadgets',
      }),
    ]);
    await addImport(harness.imports, USER_A, source.id, source.canonicalUrl);
    await addImport(harness.imports, USER_B, source.id, source.canonicalUrl);
    await harness.service.resolveAndFanOut(source.id);

    assert.equal(harness.discoveredRepo.products.size, 1);
    const discoveredId = [...harness.discoveredRepo.products.keys()][0];
    assert.equal((await harness.cart.getCart(USER_A)).items[0]?.discoveredProductId, discoveredId);
    assert.equal((await harness.cart.getCart(USER_B)).items[0]?.discoveredProductId, discoveredId);
  });

  it('does not duplicate a Bag item when the same product arrives from a second source', async () => {
    const harness = createHarness();
    const first = await insertSource(harness.sources, 'srcOne');
    const second = await insertSource(harness.sources, 'srcTwo');
    const row = {
      position: 1 as const,
      externalId: 'p1',
      name: 'Mystery Gadget',
      brand: 'Acme',
      model: 'GX1',
      category: 'gadgets',
    };
    await harness.sources.replaceProducts(first.id, [candidate(first.id, row)]);
    await harness.sources.replaceProducts(second.id, [candidate(second.id, { ...row, externalId: 'p2' })]);
    await addImport(harness.imports, USER_A, first.id, first.canonicalUrl);
    await addImport(harness.imports, USER_A, second.id, second.canonicalUrl);

    await harness.service.resolveAndFanOut(first.id);
    await harness.service.resolveAndFanOut(second.id);

    assert.equal(harness.discoveredRepo.products.size, 1);
    assert.equal((await harness.cart.getCart(USER_A)).itemCount, 1);
  });

  it('resolves multiple products in one source into multiple Bag lines', async () => {
    const harness = createHarness();
    const source = await insertSource(harness.sources, 'multi');
    await harness.sources.replaceProducts(source.id, [
      candidate(source.id, {
        position: 1,
        externalId: 'p1',
        name: 'Sony WH-1000XM5',
        brand: 'Sony',
        model: 'WH-1000XM5',
        merchantUrl: 'https://shop.example/xm5',
      }),
      candidate(source.id, {
        position: 2,
        externalId: 'p2',
        name: 'Mystery Gadget',
        brand: 'Acme',
        model: 'GX1',
        category: 'gadgets',
      }),
    ]);
    await addImport(harness.imports, USER_A, source.id, source.canonicalUrl);
    await harness.service.resolveAndFanOut(source.id);

    const products = await harness.sources.listProducts(source.id);
    assert.equal(products[0]?.catalogProductId, CATALOG_XM5);
    assert.ok(products[1]?.discoveredProductId);
    assert.equal((await harness.cart.getCart(USER_A)).itemCount, 2);
    assert.equal(harness.catalogRepo.all().length, 1);
    assert.equal(harness.discoveredRepo.products.size, 1);
  });

  it('produces one global result and 100 Bag memberships for 100 users', async () => {
    const harness = createHarness();
    const source = await insertSource(harness.sources, 'crowd');
    await harness.sources.replaceProducts(source.id, [
      candidate(source.id, {
        position: 1,
        externalId: 'p1',
        name: 'Mystery Gadget',
        brand: 'Acme',
        model: 'GX1',
        category: 'gadgets',
      }),
    ]);
    for (let i = 0; i < 100; i += 1) {
      const userId = `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`;
      await addImport(harness.imports, userId, source.id, source.canonicalUrl);
    }

    await harness.service.resolveAndFanOut(source.id);

    const products = await harness.sources.listProducts(source.id);
    assert.equal(products.length, 1);
    assert.ok(products[0]?.discoveredProductId);
    assert.equal(harness.discoveredRepo.products.size, 1);
    assert.equal(harness.catalogRepo.all().length, 1, 'seeded catalogue row only');

    let memberships = 0;
    for (let i = 0; i < 100; i += 1) {
      const userId = `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`;
      const bag = await harness.cart.getCart(userId);
      assert.equal(bag.itemCount, 1);
      assert.equal(bag.items[0]?.discoveredProductId, products[0]?.discoveredProductId);
      assert.equal(bag.items[0]?.source?.contentSourceId, source.id);
      memberships += bag.itemCount;
    }
    assert.equal(memberships, 100);
  });

  it('is idempotent when resolveAndFanOut runs twice', async () => {
    const harness = createHarness();
    const source = await insertSource(harness.sources, 'again');
    await harness.sources.replaceProducts(source.id, [
      candidate(source.id, {
        position: 1,
        externalId: 'p1',
        name: 'Mystery Gadget',
        brand: 'Acme',
        model: 'GX1',
        category: 'gadgets',
      }),
    ]);
    await addImport(harness.imports, USER_A, source.id, source.canonicalUrl);
    await harness.service.resolveAndFanOut(source.id);
    await harness.service.resolveAndFanOut(source.id);
    assert.equal(harness.discoveredRepo.products.size, 1);
    assert.equal((await harness.cart.getCart(USER_A)).itemCount, 1);
  });
});
