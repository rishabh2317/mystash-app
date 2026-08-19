import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CatalogService } from './CatalogService';
import { InMemoryCatalogRepository } from './InMemoryCatalogRepository';
import type { CollectionTagRemapPort } from './ports';
import type { CatalogProduct } from '../product-intelligence/domain/types';

function baseProduct(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: overrides.id ?? 'a',
    canonicalSlug: overrides.canonicalSlug ?? 'product-a',
    brand: overrides.brand ?? 'Acme',
    name: overrides.name ?? 'Widget',
    normalizedName: overrides.normalizedName ?? 'widget',
    model: overrides.model ?? null,
    category: overrides.category ?? 'gadgets',
    description: overrides.description ?? null,
    imageUrl: overrides.imageUrl ?? null,
    merchant: overrides.merchant ?? null,
    merchantUrl: overrides.merchantUrl ?? null,
    preferredShoppingUrl: overrides.preferredShoppingUrl ?? null,
    affiliateUrl: overrides.affiliateUrl ?? null,
    shoppingProvider: overrides.shoppingProvider ?? null,
    currency: overrides.currency ?? null,
    price: overrides.price ?? null,
    status: overrides.status ?? 'ACTIVE',
    verificationStatus: overrides.verificationStatus ?? 'VERIFIED',
    verificationProvider: overrides.verificationProvider ?? 'test',
    verificationSource: overrides.verificationSource ?? 'test',
    verificationVersion: overrides.verificationVersion ?? 'v1',
    lastVerifiedAt: overrides.lastVerifiedAt ?? new Date().toISOString(),
    aiConfidence: overrides.aiConfidence ?? 0.9,
    matchConfidence: overrides.matchConfidence ?? 0.9,
    verificationConfidence: overrides.verificationConfidence ?? 0.9,
    mergedIntoId: overrides.mergedIntoId ?? null,
    metadata: overrides.metadata ?? {},
  };
}

describe('CatalogService', () => {
  it('creates from resolve and looks up by id/slug', async () => {
    const repo = new InMemoryCatalogRepository();
    const svc = new CatalogService(repo);
    const created = await svc.createFromResolve({
      name: 'Galaxy Z Fold',
      normalizedName: 'galaxy z fold',
      canonicalSlug: 'galaxy-z-fold',
      brand: 'Samsung',
      model: 'Z Fold',
      category: 'phones',
      verificationStatus: 'VERIFIED',
      verificationSource: 'test',
      verificationVersion: 'v1',
      aliases: ['z fold'],
    });
    assert.equal(created.verificationStatus, 'VERIFIED');
    assert.equal((await svc.getById(created.id))?.name, 'Galaxy Z Fold');
    assert.equal((await svc.getBySlug('galaxy-z-fold'))?.id, created.id);
    assert.equal((await svc.findByAlias('z fold'))[0]?.id, created.id);
  });

  it('resolves active product through merge chain', async () => {
    const repo = new InMemoryCatalogRepository();
    const remaps: Array<{ sourceId: string; targetId: string }> = [];
    const tagRemap: CollectionTagRemapPort = {
      async remapCatalogProduct(sourceId, targetId) {
        remaps.push({ sourceId, targetId });
        return { remapped: 1, collisionsResolved: 0 };
      },
    };
    const svc = new CatalogService(repo, tagRemap);
    repo.seed(baseProduct({ id: 'src', canonicalSlug: 'src', name: 'Src', normalizedName: 'src' }));
    repo.seed(
      baseProduct({
        id: 'dst',
        canonicalSlug: 'dst',
        name: 'Dst',
        normalizedName: 'dst',
        verificationStatus: 'UNVERIFIED',
      }),
    );

    const survivor = await svc.merge('src', 'dst');
    assert.equal(survivor.id, 'dst');
    const src = await svc.getById('src');
    assert.equal(src?.status, 'MERGED');
    assert.equal(src?.mergedIntoId, 'dst');
    const active = await svc.resolveActiveProduct('src');
    assert.equal(active?.id, 'dst');
    assert.deepEqual(remaps, [{ sourceId: 'src', targetId: 'dst' }]);
  });

  it('ensureUnresolvedPlaceholder creates UNRESOLVED product', async () => {
    const svc = new CatalogService(new InMemoryCatalogRepository());
    const p = await svc.ensureUnresolvedPlaceholder({
      draftId: 'draft-1',
      name: 'Unknown Gadget',
      merchantUrl: 'https://shop.example/p/1',
    });
    assert.equal(p.verificationStatus, 'UNRESOLVED');
    assert.equal(p.verificationSource, 'publish_placeholder');
    assert.match(p.canonicalSlug, /publish-draft-1/);
  });

  it('applyShoppingProjection does not clear verification merchant url', async () => {
    const repo = new InMemoryCatalogRepository();
    repo.seed(
      baseProduct({
        id: 'p1',
        merchantUrl: 'https://verify.example/p',
        preferredShoppingUrl: null,
      }),
    );
    const svc = new CatalogService(repo);
    const updated = await svc.applyShoppingProjection('p1', {
      preferredShoppingUrl: 'https://shop.example/buy',
      shoppingProvider: 'amazon',
    });
    assert.equal(updated.merchantUrl, 'https://verify.example/p');
    assert.equal(updated.preferredShoppingUrl, 'https://shop.example/buy');
    assert.equal(updated.shoppingProvider, 'amazon');
  });

  it('hides and restores lifecycle', async () => {
    const repo = new InMemoryCatalogRepository();
    repo.seed(baseProduct({ id: 'p1' }));
    const svc = new CatalogService(repo);
    const hidden = await svc.applyLifecycle('p1', 'hide');
    assert.equal(hidden.status, 'HIDDEN');
    const active = await svc.applyLifecycle('p1', 'unhide');
    assert.equal(active.status, 'ACTIVE');
  });
});
