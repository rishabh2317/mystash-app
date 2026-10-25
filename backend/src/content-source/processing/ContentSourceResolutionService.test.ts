import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { getPdpSearchHints } from '../../product-intelligence/search/pdpSearchHints';
import type { PdpRankHints } from '../../product-intelligence/search/PdpRanker';
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

function assertNoStashRows(harness: {
  discoveredRepo: InMemoryDiscoveredProductRepository;
  cartRepo: InMemoryCartRepository;
}): void {
  assert.equal(harness.discoveredRepo.products.size, 0);
  assert.equal(harness.cartRepo.items.size, 0);
}

function createHarness(opts?: {
  search?: () => Promise<SearchResult>;
  onHints?: (hints: PdpRankHints) => void;
}) {
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
        if (opts?.search) return opts.search();
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
    {
      resolveForUserImport: async (drafts) => {
        opts?.onHints?.(getPdpSearchHints());
        return resolver.resolveForUserImport(drafts);
      },
      getCatalogProduct: (id) => catalog.getById(id),
    },
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
    cartRepo,
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
    assert.equal(bagA.items[0]?.product?.category, 'electronics');
  });

  it('does not persist a product when every search candidate is rejected', async () => {
    const harness = createHarness();
    const source = await insertSource(harness.sources, 'missVideo');
    await harness.sources.replaceProducts(source.id, [
      candidate(source.id, {
        position: 1,
        externalId: 'p1',
        name: 'Acme GX1 Headphones',
        brand: 'Acme',
        model: 'GX1',
        category: 'headphones',
        merchantUrl: 'https://shop.example/rejected',
      }),
    ]);
    await addImport(harness.imports, USER_A, source.id, source.canonicalUrl);

    const attached = await harness.service.resolveAndFanOut(source.id);

    assert.equal(attached, 0);
    assert.equal(harness.searched(), 1);
    const products = await harness.sources.listProducts(source.id);
    assert.equal(products[0]?.catalogProductId, null);
    assert.equal(products[0]?.discoveredProductId, null);
    assertNoStashRows(harness);
  });

  it('leaves a vision-only hallucination unbound', async () => {
    const harness = createHarness();
    const source = await insertSource(harness.sources, 'visionOnly');
    await harness.sources.replaceProducts(source.id, [
      candidate(source.id, {
        position: 1,
        externalId: 'p1',
        name: 'Invented Headset',
        brand: 'Nope',
        model: 'X1',
        sources: ['VISION'],
        merchantUrl: 'https://www.amazon.com/dp/B0FAKEHALLUC',
      }),
    ]);
    await addImport(harness.imports, USER_A, source.id, source.canonicalUrl);
    assert.equal(await harness.service.resolveAndFanOut(source.id), 0);
    assert.equal(harness.searched(), 0);
    assertNoStashRows(harness);
  });

  it('does not attach a GPT-only web page', async () => {
    const harness = createHarness();
    const source = await insertSource(harness.sources, 'gptWeb');
    await harness.sources.replaceProducts(source.id, [
      candidate(source.id, {
        position: 1,
        externalId: 'p1',
        name: 'Guessed Dress',
        brand: 'Zara',
        extractionMethod: 'merchant_enrichment',
        sources: [],
        evidence: { identitySource: 'tavily_gpt' },
        merchantUrl: 'https://www.zara.com/us/en/satin-midi-dress-p1.html',
      }),
    ]);
    await addImport(harness.imports, USER_A, source.id, source.canonicalUrl);
    assert.equal(await harness.service.resolveAndFanOut(source.id), 0);
    assert.equal(harness.searched(), 0);
    assertNoStashRows(harness);
  });

  it('does not bind a VERIFIED catalog row whose merchant URL is a different product', async () => {
    const harness = createHarness();
    const neudisUrl = 'https://www.amazon.com/NEUDIS-Women-Satin-Dress/dp/B0NEUDIS01';
    harness.catalogRepo.seed(
      catalogProduct({
        id: '550e8400-e29b-41d4-a716-446655440299',
        name: 'NEUDIS Women Satin Dress',
        brand: 'NEUDIS',
        model: null,
        normalizedName: 'neudis women satin dress',
        merchantUrl: neudisUrl,
        preferredShoppingUrl: neudisUrl,
        category: 'fashion',
      }),
    );
    const source = await insertSource(harness.sources, 'wrongUrl');
    await harness.sources.replaceProducts(source.id, [
      candidate(source.id, {
        position: 1,
        externalId: 'p1',
        name: 'Zara Satin Midi Dress',
        brand: 'Zara',
        category: 'fashion',
        merchantUrl: neudisUrl,
      }),
    ]);
    await addImport(harness.imports, USER_A, source.id, source.canonicalUrl);
    assert.equal(await harness.service.resolveAndFanOut(source.id), 0);
    const products = await harness.sources.listProducts(source.id);
    assert.equal(products[0]?.catalogProductId, null);
    assertNoStashRows(harness);
  });

  it('does not bind a brand+model catalog row that fails identity', async () => {
    const harness = createHarness();
    harness.catalogRepo.seed(
      catalogProduct({
        id: '550e8400-e29b-41d4-a716-446655440288',
        name: 'Acme Phone Case',
        brand: 'Acme',
        model: 'GX9',
        normalizedName: 'acme phone case',
        merchantUrl: 'https://shop.example/case',
        preferredShoppingUrl: 'https://shop.example/case',
        category: 'electronics',
      }),
    );
    const source = await insertSource(harness.sources, 'wrongModelRow');
    await harness.sources.replaceProducts(source.id, [
      candidate(source.id, {
        position: 1,
        externalId: 'p1',
        name: 'Acme GX9 Headphones',
        brand: 'Acme',
        model: 'GX9',
        category: 'headphones',
      }),
    ]);
    await addImport(harness.imports, USER_A, source.id, source.canonicalUrl);
    assert.equal(await harness.service.resolveAndFanOut(source.id), 0);
    assertNoStashRows(harness);
  });

  it('passes the same identity expectation into resolve, not an empty hint store', async () => {
    let seen: PdpRankHints | undefined;
    const harness = createHarness({ onHints: (hints) => { seen = hints; } });
    const source = await insertSource(harness.sources, 'hints');
    await harness.sources.replaceProducts(source.id, [
      candidate(source.id, {
        position: 1,
        externalId: 'p1',
        name: 'Bose SoundLink Max',
        brand: 'Bose',
        model: 'SoundLink Max',
        category: 'electronics',
      }),
    ]);
    await addImport(harness.imports, USER_A, source.id, source.canonicalUrl);
    await harness.service.resolveAndFanOut(source.id);
    assert.equal(seen?.brand, 'Bose');
    assert.match(seen?.name ?? '', /bose soundlink max/i);
    assert.match(seen?.model ?? '', /soundlink max/i);
    assert.ok(seen?.category);
    assert.notEqual(JSON.stringify(seen), '{}');
  });

  it('attaches one validated product and leaves the rejected sibling unbound', async () => {
    const harness = createHarness();
    const source = await insertSource(harness.sources, 'mixed');
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
        name: 'Acme GX1 Headphones',
        brand: 'Acme',
        model: 'GX1',
        sources: ['TRANSCRIPT'],
      }),
    ]);
    await addImport(harness.imports, USER_A, source.id, source.canonicalUrl);
    assert.equal(await harness.service.resolveAndFanOut(source.id), 1);
    const products = await harness.sources.listProducts(source.id);
    assert.equal(products[0]?.catalogProductId, CATALOG_XM5);
    assert.equal(products[1]?.discoveredProductId, null);
    assert.equal(harness.discoveredRepo.products.size, 0);
    assert.equal(harness.cartRepo.items.size, 1);
  });

  it('does not duplicate a Bag item when the same catalog product arrives from a second source', async () => {
    const harness = createHarness();
    const first = await insertSource(harness.sources, 'srcOne');
    const second = await insertSource(harness.sources, 'srcTwo');
    const row = {
      position: 1 as const,
      externalId: 'p1',
      name: 'Sony WH-1000XM5',
      brand: 'Sony',
      model: 'WH-1000XM5',
      merchantUrl: 'https://shop.example/xm5',
    };
    await harness.sources.replaceProducts(first.id, [candidate(first.id, row)]);
    await harness.sources.replaceProducts(second.id, [candidate(second.id, { ...row, externalId: 'p2' })]);
    await addImport(harness.imports, USER_A, first.id, first.canonicalUrl);
    await addImport(harness.imports, USER_A, second.id, second.canonicalUrl);
    await harness.service.resolveAndFanOut(first.id);
    await harness.service.resolveAndFanOut(second.id);
    assert.equal(harness.discoveredRepo.products.size, 0);
    assert.equal(harness.cartRepo.items.size, 1);
  });

  it('fans one catalog product out to every importer', async () => {
    const harness = createHarness();
    const source = await insertSource(harness.sources, 'crowd');
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
    for (let i = 0; i < 100; i += 1) {
      const userId = `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`;
      await addImport(harness.imports, userId, source.id, source.canonicalUrl);
    }
    assert.equal(await harness.service.resolveAndFanOut(source.id), 1);
    assert.equal(harness.discoveredRepo.products.size, 0);
    assert.equal(harness.cartRepo.items.size, 100);
  });

  it('is idempotent when resolveAndFanOut runs twice', async () => {
    const harness = createHarness();
    const source = await insertSource(harness.sources, 'again');
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
    await addImport(harness.imports, USER_A, source.id, source.canonicalUrl);
    await harness.service.resolveAndFanOut(source.id);
    await harness.service.resolveAndFanOut(source.id);
    assert.equal(harness.discoveredRepo.products.size, 0);
    assert.equal(harness.cartRepo.items.size, 1);
  });

  it('does not attach a contradictory search page', async () => {
    const pages: Record<string, { title: string; brand: string; url: string }> = {
      brand: {
        title: 'NEUDIS Women Satin Midi Dress',
        brand: 'NEUDIS',
        url: 'https://www.amazon.com/NEUDIS-Women-Satin-Dress/dp/B0NEUDIS01',
      },
      model: {
        title: 'Bose SoundLink Mini',
        brand: 'Bose',
        url: 'https://www.bose.com/soundlink-mini',
      },
      color: {
        title: 'Zara Black Satin Midi Dress',
        brand: 'Zara',
        url: 'https://www.zara.com/black-satin-midi-dress-p1.html',
      },
      type: {
        title: 'Zara Satin Headphones',
        brand: 'Zara',
        url: 'https://www.zara.com/satin-headphones-p1.html',
      },
    };
    const expectations = {
      brand: { name: 'Zara Satin Midi Dress', brand: 'Zara', model: null, category: 'fashion' },
      model: { name: 'Bose SoundLink Max', brand: 'Bose', model: 'SoundLink Max', category: 'electronics' },
      color: { name: 'Zara Olive Satin Midi Dress', brand: 'Zara', model: null, category: 'fashion' },
      type: { name: 'Zara Satin Midi Dress', brand: 'Zara', model: null, category: 'fashion' },
    };
    for (const key of ['brand', 'model', 'color', 'type'] as const) {
      const page = pages[key];
      const harness = createHarness({
        search: async () => ({
          kind: 'Succeeded',
          provider: 'mock',
          candidates: [
            {
              merchant: 'shop',
              merchantUrl: page.url,
              title: page.title,
              image: 'https://img.example/p.jpg',
              score: 0.95,
              brand: page.brand,
              price: '40',
              currency: 'USD',
              pdpScore: 0.8,
              pdpVerdict: 'pdp' as const,
              enrichmentSucceeded: true,
              sourceType: 'OFFICIAL' as const,
              pageType: 'PRODUCT' as const,
              capabilities: { metadata: true, commerce: true, specifications: true, images: true, evidence: true },
            },
          ],
        }),
      });
      const source = await insertSource(harness.sources, `bad-${key}`);
      await harness.sources.replaceProducts(source.id, [
        candidate(source.id, {
          position: 1,
          externalId: 'p1',
          ...expectations[key],
          sources: ['TRANSCRIPT'],
        }),
      ]);
      await addImport(harness.imports, USER_A, source.id, source.canonicalUrl);
      assert.equal(await harness.service.resolveAndFanOut(source.id), 0, key);
      assertNoStashRows(harness);
    }
  });

  it('does not attach when search or enrichment fails', async () => {
    for (const mode of ['provider', 'enrichment'] as const) {
      const harness = createHarness({
        search: async () =>
          mode === 'provider'
            ? { kind: 'Failed', provider: 'mock', errorKind: 'unknown', message: 'serper down' }
            : {
                kind: 'Succeeded',
                provider: 'mock',
                candidates: [
                  {
                    merchant: 'shop',
                    merchantUrl: 'https://shop.example/p',
                    title: 'Acme GX1 Headphones',
                    image: null,
                    score: 0.9,
                    brand: 'Acme',
                    pdpScore: 0,
                    pdpVerdict: 'uncertain' as const,
                    enrichmentSucceeded: false,
                  },
                ],
              },
      });
      const source = await insertSource(harness.sources, mode);
      await harness.sources.replaceProducts(source.id, [
        candidate(source.id, {
          position: 1,
          externalId: 'p1',
          name: 'Acme GX1 Headphones',
          brand: 'Acme',
          model: 'GX1',
          sources: ['OCR'],
        }),
      ]);
      await addImport(harness.imports, USER_A, source.id, source.canonicalUrl);
      assert.equal(await harness.service.resolveAndFanOut(source.id), 0, mode);
      assertNoStashRows(harness);
    }
  });

  it('does not attach an ambiguous generic name', async () => {
    const harness = createHarness();
    const source = await insertSource(harness.sources, 'generic');
    await harness.sources.replaceProducts(source.id, [
      candidate(source.id, {
        position: 1,
        externalId: 'p1',
        name: 'Dress',
        brand: null,
        model: null,
        sources: ['METADATA'],
      }),
    ]);
    await addImport(harness.imports, USER_A, source.id, source.canonicalUrl);
    assert.equal(await harness.service.resolveAndFanOut(source.id), 0);
    assert.equal(harness.searched(), 0);
    assertNoStashRows(harness);
  });

  it('does not bag a pre-bound catalog row that fails the same identity expectation', async () => {
    const harness = createHarness();
    const wrongId = '550e8400-e29b-41d4-a716-446655440277';
    harness.catalogRepo.seed(
      catalogProduct({
        id: wrongId,
        name: 'Sony WH-1000XM4',
        brand: 'Sony',
        model: 'WH-1000XM4',
        normalizedName: 'sony wh 1000xm4',
        merchantUrl: 'https://shop.example/xm4',
        preferredShoppingUrl: 'https://shop.example/xm4',
      }),
    );
    const source = await insertSource(harness.sources, 'prebound');
    const [row] = await harness.sources.replaceProducts(source.id, [
      candidate(source.id, {
        position: 1,
        externalId: 'p1',
        name: 'Sony WH-1000XM5',
        brand: 'Sony',
        model: 'WH-1000XM5',
        merchantUrl: 'https://shop.example/xm5',
      }),
    ]);
    await harness.sources.bindProductResolution(row!.id, {
      catalogProductId: wrongId,
      discoveredProductId: null,
    });
    await addImport(harness.imports, USER_A, source.id, source.canonicalUrl);
    assert.equal(await harness.service.resolveAndFanOut(source.id), 1);
    const products = await harness.sources.listProducts(source.id);
    assert.equal(products[0]?.catalogProductId, CATALOG_XM5);
    assert.equal(harness.discoveredRepo.products.size, 0);
    assert.equal(harness.cartRepo.items.size, 1);
    assert.equal(harness.cartRepo.items.values().next().value?.catalogProductId, CATALOG_XM5);
  });

  it('drops a pre-bound discovered product that contradicts the expectation and does not create another', async () => {
    const harness = createHarness();
    const source = await insertSource(harness.sources, 'prediscovered');
    const [row] = await harness.sources.replaceProducts(source.id, [
      candidate(source.id, {
        position: 1,
        externalId: 'p1',
        name: "Levi's 501 Black Jeans",
        brand: "Levi's",
        model: '501',
        category: 'fashion',
        sources: ['OCR'],
      }),
    ]);
    const discovered = new DiscoveredProductService(harness.discoveredRepo);
    const saved = await discovered.getOrCreate(
      {
        name: "Levi's Grey Jogger",
        brand: "Levi's",
        model: null,
        category: 'fashion',
        imageUrl: null,
        price: null,
        currency: null,
        merchant: 'myntra',
        merchantUrl: 'https://www.myntra.com/grey-jogger/p/itm123',
        identityKey: 'jogger-prebound',
        metadata: {},
        matchConfidence: null,
        completeness: null,
      },
      'v1',
    );
    await harness.sources.bindProductResolution(row!.id, {
      catalogProductId: null,
      discoveredProductId: saved.record.id,
    });
    await addImport(harness.imports, USER_A, source.id, source.canonicalUrl);
    assert.equal(await harness.service.resolveAndFanOut(source.id), 0);
    const products = await harness.sources.listProducts(source.id);
    assert.equal(products[0]?.discoveredProductId, null);
    assert.equal(products[0]?.catalogProductId, null);
    assert.equal(harness.discoveredRepo.products.size, 1);
    assert.equal(harness.cartRepo.items.size, 0);
  });

  function linePage(title: string, brand: string, merchantUrl: string) {
    return {
      merchant: 'amazon.com',
      merchantUrl,
      title,
      image: 'https://img.example/p.jpg',
      score: 1,
      brand,
      price: '180',
      currency: 'USD',
      pdpScore: 0.9,
      pdpVerdict: 'pdp' as const,
      enrichmentSucceeded: true,
      sourceType: 'MARKETPLACE' as const,
      pageType: 'PRODUCT' as const,
      capabilities: {
        metadata: true,
        commerce: true,
        specifications: true,
        images: true,
        evidence: true,
      },
    };
  }

  async function resolveLine(
    name: string,
    extra: Partial<InsertContentSourceProductRow>,
    search: () => Promise<SearchResult>,
  ) {
    let hints: PdpRankHints | undefined;
    const harness = createHarness({
      onHints: (value) => {
        hints = value;
      },
      search,
    });
    const source = await insertSource(harness.sources, name.replace(/\s+/g, '').slice(0, 24));
    await harness.sources.replaceProducts(source.id, [
      candidate(source.id, {
        position: 1,
        externalId: 'p-line',
        name,
        brand: extra.brand ?? 'Nike',
        model: extra.model ?? null,
        category: extra.category ?? 'fashion',
        sources: ['METADATA'],
        confidence: 0.9,
        ...extra,
      }),
    ]);
    await addImport(harness.imports, USER_A, source.id, source.canonicalUrl);
    const attached = await harness.service.resolveAndFanOut(source.id);
    return { harness, attached, hints };
  }

  it('attaches a brand-backed line when the PDP is the same product', async () => {
    const { harness, attached, hints } = await resolveLine('Mind Shoes', { brand: 'Nike', model: null }, async () => ({
      kind: 'Succeeded',
      provider: 'mock',
      candidates: [
        linePage(
          'Nike Mind Shoes',
          'Nike',
          'https://www.amazon.com/Nike-Mind-Shoes/dp/B0MIND001',
        ),
      ],
    }));
    assert.equal(hints?.brand, 'Nike');
    assert.equal(hints?.name, 'Mind Shoes');
    assert.equal(hints?.model ?? null, null);
    assert.equal(attached, 1);
    assert.equal(harness.searched(), 1);
    assert.equal(harness.discoveredRepo.products.size, 1);
    assert.equal(harness.cartRepo.items.size, 1);
    const saved = [...harness.discoveredRepo.products.values()][0];
    assert.match(saved?.name ?? '', /mind/i);
    assert.equal(saved?.brand, 'Nike');
  });

  it('does not stash a brand-backed line when the PDP is a different brand', async () => {
    const { harness, attached } = await resolveLine('Mind Shoes', { brand: 'Nike' }, async () => ({
      kind: 'Succeeded',
      provider: 'mock',
      candidates: [
        linePage(
          'Adidas Mind Shoes',
          'Adidas',
          'https://www.adidas.com/mind-shoes/p/mind1',
        ),
      ],
    }));
    assert.equal(attached, 0);
    assert.equal(harness.searched(), 1);
    assertNoStashRows(harness);
  });

  it('does not stash a searchable model when the PDP names a different model', async () => {
    const { harness, attached } = await resolveLine(
      'Sony WH-1000XM6',
      { brand: 'Sony', model: 'WH-1000XM6', category: 'electronics' },
      async () => ({
        kind: 'Succeeded',
        provider: 'mock',
        candidates: [
          linePage(
            'Sony WH-1000XM4 Wireless Headphones',
            'Sony',
            'https://www.amazon.com/Sony-WH-1000XM4/dp/B0XM4MODEL',
          ),
        ],
      }),
    );
    assert.equal(attached, 0);
    assert.equal(harness.searched(), 1);
    assertNoStashRows(harness);
  });

  it('does not stash a brand-backed line when the PDP names another color', async () => {
    const { harness, attached } = await resolveLine(
      'Mind Shoes Black',
      { brand: 'Nike' },
      async () => ({
        kind: 'Succeeded',
        provider: 'mock',
        candidates: [
          linePage(
            'Nike Mind Shoes White',
            'Nike',
            'https://www.nike.com/mind-shoes-white/p/white1',
          ),
        ],
      }),
    );
    assert.equal(attached, 0);
    assert.equal(harness.searched(), 1);
    assertNoStashRows(harness);
  });

  it('does not stash a brand-backed line when the PDP is a different product type', async () => {
    const { harness, attached } = await resolveLine('Mind Shoes', { brand: 'Nike' }, async () => ({
      kind: 'Succeeded',
      provider: 'mock',
      candidates: [
        linePage(
          'Nike Mind Jacket',
          'Nike',
          'https://www.nike.com/mind-jacket/p/jacket1',
        ),
      ],
    }));
    assert.equal(attached, 0);
    assert.equal(harness.searched(), 1);
    assertNoStashRows(harness);
  });

  it('does not stash a brand-backed line when no PDP names that line', async () => {
    const { harness, attached } = await resolveLine('Mind Shoes', { brand: 'Nike' }, async () => ({
      kind: 'Succeeded',
      provider: 'mock',
      candidates: [
        linePage(
          'Nike Pegasus Shoes',
          'Nike',
          'https://www.nike.com/pegasus-shoes/p/pegasus',
        ),
      ],
    }));
    assert.equal(attached, 0);
    assert.equal(harness.searched(), 1);
    assertNoStashRows(harness);
  });

  it('does not stash a brand-backed line when search fails', async () => {
    const { harness, attached } = await resolveLine('Mind Shoes', { brand: 'Nike' }, async () => ({
      kind: 'Failed',
      errorKind: 'quota',
      message: '429',
      provider: 'mock',
    }));
    assert.equal(attached, 0);
    assert.equal(harness.searched(), 1);
    assertNoStashRows(harness);
  });

  it('still does not search or stash a generic brand and product type', async () => {
    const { harness, attached } = await resolveLine('Nike Shoe', { brand: 'Nike' }, async () => ({
      kind: 'Succeeded',
      provider: 'mock',
      candidates: [
        linePage('Nike Shoe', 'Nike', 'https://www.nike.com/shoe/p/generic'),
      ],
    }));
    assert.equal(attached, 0);
    assert.equal(harness.searched(), 0);
    assertNoStashRows(harness);
  });

  it('calls CartService.addItem from exactly one site', () => {
    const src = readFileSync(join(__dirname, 'ContentSourceResolutionService.ts'), 'utf8');
    assert.equal((src.match(/this\.cart\.addItem\(/g) ?? []).length, 1);
    assert.doesNotMatch(src, /resolveForUserImportFast\(/);
  });
});
