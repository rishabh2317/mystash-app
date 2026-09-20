import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CatalogService } from '../catalog/CatalogService';
import { InMemoryCatalogRepository } from '../catalog/InMemoryCatalogRepository';
import type { CatalogProduct } from '../product-intelligence/domain/types';
import { DiscoveredProductService } from '../discovered/DiscoveredProductService';
import { InMemoryDiscoveredProductRepository } from '../discovered/InMemoryDiscoveredProductRepository';
import { CartService, CartServiceError } from './CartService';
import { InMemoryCartRepository } from './InMemoryCartRepository';
import type { CatalogCartPort, DiscoveredCartPort } from './ports';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ACTIVE = '550e8400-e29b-41d4-a716-446655440001';
const PRODUCT_HIDDEN = '550e8400-e29b-41d4-a716-446655440002';
const PRODUCT_DISCONTINUED = '550e8400-e29b-41d4-a716-446655440003';
const PRODUCT_MERGED = '550e8400-e29b-41d4-a716-446655440004';
const PRODUCT_SURVIVOR = '550e8400-e29b-41d4-a716-446655440005';
const PRODUCT_NO_DEST = '550e8400-e29b-41d4-a716-446655440006';
const DISCOVERED_A = '660e8400-e29b-41d4-a716-446655440001';
const SOURCE_CS = '770e8400-e29b-41d4-a716-446655440001';
const SOURCE_IMPORT = '880e8400-e29b-41d4-a716-446655440001';

function baseProduct(partial: Partial<CatalogProduct> & Pick<CatalogProduct, 'id' | 'name' | 'status'>): CatalogProduct {
  return {
    canonicalSlug: partial.canonicalSlug ?? `slug-${partial.id.slice(0, 8)}`,
    brand: partial.brand ?? 'Brand',
    normalizedName: partial.normalizedName ?? partial.name.toLowerCase(),
    model: partial.model ?? null,
    category: partial.category ?? 'cat',
    description: partial.description ?? null,
    imageUrl: partial.imageUrl ?? 'https://cdn.example/p.jpg',
    merchant: partial.merchant ?? 'Merchant',
    merchantUrl: partial.merchantUrl ?? 'https://shop.example/p',
    preferredShoppingUrl: partial.preferredShoppingUrl ?? null,
    affiliateUrl: partial.affiliateUrl ?? null,
    shoppingProvider: partial.shoppingProvider ?? null,
    currency: partial.currency ?? 'USD',
    price: partial.price ?? '10',
    verificationStatus: partial.verificationStatus ?? 'VERIFIED',
    verificationProvider: partial.verificationProvider ?? null,
    verificationSource: partial.verificationSource ?? null,
    verificationVersion: partial.verificationVersion ?? null,
    lastVerifiedAt: partial.lastVerifiedAt ?? null,
    aiConfidence: partial.aiConfidence ?? null,
    matchConfidence: partial.matchConfidence ?? null,
    verificationConfidence: partial.verificationConfidence ?? null,
    mergedIntoId: partial.mergedIntoId ?? null,
    metadata: partial.metadata ?? {},
    ...partial,
  };
}

function createHarness() {
  const catalogRepo = new InMemoryCatalogRepository();
  catalogRepo.seed(
    baseProduct({
      id: PRODUCT_ACTIVE,
      name: 'Active Product',
      status: 'ACTIVE',
      merchantUrl: 'https://shop.example/active',
    }),
  );
  catalogRepo.seed(
    baseProduct({
      id: PRODUCT_HIDDEN,
      name: 'Hidden Product',
      status: 'HIDDEN',
    }),
  );
  catalogRepo.seed(
    baseProduct({
      id: PRODUCT_DISCONTINUED,
      name: 'Discontinued Product',
      status: 'DISCONTINUED',
    }),
  );
  catalogRepo.seed(
    baseProduct({
      id: PRODUCT_SURVIVOR,
      name: 'Survivor Product',
      status: 'ACTIVE',
      merchantUrl: 'https://shop.example/survivor',
    }),
  );
  catalogRepo.seed(
    baseProduct({
      id: PRODUCT_MERGED,
      name: 'Merged Product',
      status: 'MERGED',
      mergedIntoId: PRODUCT_SURVIVOR,
      merchantUrl: null,
    }),
  );
  catalogRepo.seed(
    baseProduct({
      id: PRODUCT_NO_DEST,
      name: 'No Destination',
      status: 'ACTIVE',
      merchantUrl: null,
      preferredShoppingUrl: null,
      affiliateUrl: null,
    }),
  );

  const catalogService = new CatalogService(catalogRepo);
  const catalogPort: CatalogCartPort = {
    resolveActiveProduct: (id) => catalogService.resolveActiveProduct(id),
    getById: (id) => catalogService.getById(id),
    async getProductsByIds(ids) {
      const map = new Map<string, CatalogProduct>();
      for (const id of ids) {
        const p = await catalogService.getById(id);
        if (p) map.set(id, p);
      }
      return map;
    },
  };

  const discoveredRepo = new InMemoryDiscoveredProductRepository();
  discoveredRepo.seed({
    id: DISCOVERED_A,
    identityKey: 'n_testdiscoveredproduct0001',
    name: 'Imported Widget',
    brand: 'Acme',
    model: 'W1',
    category: 'gadgets',
    imageUrl: 'https://cdn.example/w.jpg',
    price: '20',
    currency: 'USD',
    merchant: 'Shop',
    merchantUrl: 'https://shop.example/w',
    metadata: { completeness: 0.4 },
    matchConfidence: 0.3,
    completeness: 0.4,
    processorVersion: 'test',
  });
  const discoveredPort: DiscoveredCartPort = {
    getById: (id) => new DiscoveredProductService(discoveredRepo).getById(id),
  };

  const repo = new InMemoryCartRepository();
  const cart = new CartService(repo, catalogPort, discoveredPort);

  return { cart, repo, catalogRepo, discoveredRepo };
}

describe('CartService', () => {
  it('returns empty cart for authenticated user', async () => {
    const { cart } = createHarness();
    const view = await cart.getCart(USER_A);
    assert.equal(view.itemCount, 0);
    assert.deepEqual(view.items, []);
  });

  it('adds an ACTIVE product', async () => {
    const { cart } = createHarness();
    const result = await cart.addItem(USER_A, { catalogProductId: PRODUCT_ACTIVE });
    assert.equal(result.created, true);
    assert.equal(result.item.catalogProductId, PRODUCT_ACTIVE);
    const view = await cart.getCart(USER_A);
    assert.equal(view.itemCount, 1);
    assert.equal(view.items[0]?.availability, 'AVAILABLE');
    assert.equal(view.items[0]?.product?.title, 'Active Product');
  });

  it('idempotent add keeps first-write attribution', async () => {
    const { cart } = createHarness();
    const first = await cart.addItem(USER_A, {
      catalogProductId: PRODUCT_ACTIVE,
      source: {
        collectionId: '550e8400-e29b-41d4-a716-4466554400aa',
        surface: 'COLLECTION',
      },
    });
    assert.equal(first.created, true);
    const second = await cart.addItem(USER_A, {
      catalogProductId: PRODUCT_ACTIVE,
      source: {
        collectionId: '550e8400-e29b-41d4-a716-4466554400bb',
        surface: 'SEARCH',
      },
    });
    assert.equal(second.created, false);
    assert.equal(second.item.id, first.item.id);
    assert.equal(second.item.sourceCollectionId, '550e8400-e29b-41d4-a716-4466554400aa');
    assert.equal(second.item.sourceSurface, 'COLLECTION');
  });

  it('handles concurrent duplicate add via unique violation', async () => {
    const { cart, repo } = createHarness();
    await cart.addItem(USER_A, { catalogProductId: PRODUCT_ACTIVE });
    await assert.rejects(
      () =>
        repo.insert({
          userId: USER_A,
          catalogProductId: PRODUCT_ACTIVE,
          discoveredProductId: null,
          sourceCollectionId: null,
          sourceCreatorId: null,
          sourceCollectionProductTagId: null,
          sourceSurface: null,
          sourceContentSourceId: null,
          sourceUserImportId: null,
        }),
      (err: unknown) => isUniqueLike(err),
    );
    const again = await cart.addItem(USER_A, { catalogProductId: PRODUCT_ACTIVE });
    assert.equal(again.created, false);
  });

  it('rejects invalid catalogProductId', async () => {
    const { cart } = createHarness();
    await assert.rejects(
      () => cart.addItem(USER_A, { catalogProductId: 'not-uuid' }),
      (e: unknown) => e instanceof CartServiceError && e.statusCode === 400,
    );
  });

  it('rejects missing product', async () => {
    const { cart } = createHarness();
    await assert.rejects(
      () =>
        cart.addItem(USER_A, {
          catalogProductId: '550e8400-e29b-41d4-a716-446655440099',
        }),
      (e: unknown) => e instanceof CartServiceError && e.statusCode === 404,
    );
  });

  it('rejects HIDDEN and DISCONTINUED on add', async () => {
    const { cart } = createHarness();
    await assert.rejects(
      () => cart.addItem(USER_A, { catalogProductId: PRODUCT_HIDDEN }),
      (e: unknown) => e instanceof CartServiceError && e.statusCode === 404,
    );
    await assert.rejects(
      () => cart.addItem(USER_A, { catalogProductId: PRODUCT_DISCONTINUED }),
      (e: unknown) => e instanceof CartServiceError && e.statusCode === 404,
    );
  });

  it('MERGED add resolves to survivor', async () => {
    const { cart } = createHarness();
    const result = await cart.addItem(USER_A, { catalogProductId: PRODUCT_MERGED });
    assert.equal(result.created, true);
    assert.equal(result.item.catalogProductId, PRODUCT_SURVIVOR);
  });

  it('allows ACTIVE with no destination but marks NO_DESTINATION on read', async () => {
    const { cart } = createHarness();
    await cart.addItem(USER_A, { catalogProductId: PRODUCT_NO_DEST });
    const view = await cart.getCart(USER_A);
    assert.equal(view.items[0]?.availability, 'NO_DESTINATION');
  });

  it('keeps existing item as UNAVAILABLE when product later becomes HIDDEN', async () => {
    const { cart, catalogRepo } = createHarness();
    await cart.addItem(USER_A, { catalogProductId: PRODUCT_ACTIVE });
    const existing = await catalogRepo.findById(PRODUCT_ACTIVE);
    assert.ok(existing);
    catalogRepo.seed({ ...existing, status: 'HIDDEN' });
    const view = await cart.getCart(USER_A);
    assert.equal(view.itemCount, 1);
    assert.equal(view.items[0]?.availability, 'UNAVAILABLE');
  });

  it('removes existing and is idempotent when missing', async () => {
    const { cart } = createHarness();
    await cart.addItem(USER_A, { catalogProductId: PRODUCT_ACTIVE });
    const first = await cart.removeItem(USER_A, PRODUCT_ACTIVE, 'user_remove');
    assert.equal(first.removed, true);
    const second = await cart.removeItem(USER_A, PRODUCT_ACTIVE, 'purchase_confirmed');
    assert.equal(second.removed, false);
    assert.equal((await cart.getCart(USER_A)).itemCount, 0);
  });

  it('isolates carts between users', async () => {
    const { cart } = createHarness();
    await cart.addItem(USER_A, { catalogProductId: PRODUCT_ACTIVE });
    await cart.addItem(USER_B, { catalogProductId: PRODUCT_NO_DEST });
    assert.equal((await cart.getCart(USER_A)).itemCount, 1);
    assert.equal((await cart.getCart(USER_B)).itemCount, 1);
    assert.equal((await cart.getCart(USER_A)).items[0]?.catalogProductId, PRODUCT_ACTIVE);
    assert.equal((await cart.getCart(USER_B)).items[0]?.catalogProductId, PRODUCT_NO_DEST);
  });

  it('remaps catalog merge with collision', async () => {
    const { cart, repo } = createHarness();
    await cart.addItem(USER_A, { catalogProductId: PRODUCT_ACTIVE });
    // Simulate a line still pointing at merged tombstone id while survivor also present.
    await repo.insert({
      userId: USER_A,
      catalogProductId: PRODUCT_MERGED,
      discoveredProductId: null,
      sourceCollectionId: null,
      sourceCreatorId: null,
      sourceCollectionProductTagId: null,
      sourceSurface: null,
      sourceContentSourceId: null,
      sourceUserImportId: null,
    });
    // Remap MERGED → SURVIVOR; also add survivor for another user path
    await cart.addItem(USER_B, { catalogProductId: PRODUCT_SURVIVOR });
    await repo.insert({
      userId: USER_B,
      catalogProductId: PRODUCT_MERGED,
      discoveredProductId: null,
      sourceCollectionId: null,
      sourceCreatorId: null,
      sourceCollectionProductTagId: null,
      sourceSurface: null,
      sourceContentSourceId: null,
      sourceUserImportId: null,
    });

    const result = await cart.remapAfterCatalogMerge(PRODUCT_MERGED, PRODUCT_SURVIVOR);
    assert.ok(result.remapped + result.collisionsResolved >= 1);

    const userB = await cart.getCart(USER_B);
    assert.equal(userB.itemCount, 1);
    assert.equal(userB.items[0]?.catalogProductId, PRODUCT_SURVIVOR);
  });

  it('requires userId', async () => {
    const { cart } = createHarness();
    await assert.rejects(
      () => cart.getCart(''),
      (e: unknown) => e instanceof CartServiceError && e.statusCode === 401,
    );
  });

  it('adds a discovered product without a discovered label on the projection', async () => {
    const { cart } = createHarness();
    const result = await cart.addItem(USER_A, {
      discoveredProductId: DISCOVERED_A,
      source: {
        surface: 'USER_IMPORT',
        contentSourceId: SOURCE_CS,
        userImportId: SOURCE_IMPORT,
      },
    });
    assert.equal(result.created, true);
    assert.equal(result.item.discoveredProductId, DISCOVERED_A);
    assert.equal(result.item.catalogProductId, null);
    const view = await cart.getCart(USER_A);
    assert.equal(view.itemCount, 1);
    assert.equal(view.items[0]?.discoveredProductId, DISCOVERED_A);
    assert.equal(view.items[0]?.product?.title, 'Imported Widget');
    assert.equal(view.items[0]?.product?.metadataCompleteness, null);
    assert.equal(view.items[0]?.source?.surface, 'USER_IMPORT');
    assert.equal(view.items[0]?.source?.contentSourceId, SOURCE_CS);
    assert.doesNotMatch(JSON.stringify(view.items[0]?.product), /discovered/i);
  });

  it('is idempotent for the same user and discovered product', async () => {
    const { cart } = createHarness();
    const first = await cart.addItem(USER_A, { discoveredProductId: DISCOVERED_A });
    const second = await cart.addItem(USER_A, {
      discoveredProductId: DISCOVERED_A,
      source: { surface: 'USER_IMPORT', contentSourceId: SOURCE_CS },
    });
    assert.equal(second.created, false);
    assert.equal(second.item.id, first.item.id);
    assert.equal((await cart.getCart(USER_A)).itemCount, 1);
  });

  it('rejects providing both catalog and discovered ids', async () => {
    const { cart } = createHarness();
    await assert.rejects(
      () =>
        cart.addItem(USER_A, {
          catalogProductId: PRODUCT_ACTIVE,
          discoveredProductId: DISCOVERED_A,
        }),
      (e: unknown) => e instanceof CartServiceError && e.statusCode === 400,
    );
  });
});

function isUniqueLike(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  return e.code === '23505' || Boolean(e.message?.toLowerCase().includes('duplicate'));
}
