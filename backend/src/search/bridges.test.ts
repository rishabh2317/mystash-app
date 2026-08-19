import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { catalogProductToSearchIndexInput } from './catalogBridge';
import { collectionToSearchIndexInput } from './collectionBridge';
import { userToCreatorIndexInput } from './userBridge';
import type { CatalogProduct } from '../catalog/domain/types';
import type { Collection } from '../collection/domain/types';
import type { User } from '../user/domain/types';

describe('Search projection bridges (propagation mapping)', () => {
  it('maps published Collection to eligible Search input', () => {
    const c = {
      id: 'col-1',
      slug: 's',
      searchTitle: 'T',
      searchText: 'body',
      searchKeywords: [],
      searchBrands: [],
      searchCategories: [],
      searchEligible: true,
      contentRevision: 2,
      creatorId: 'u1',
      creatorName: 'N',
      creatorUsername: 'n',
      creatorAvatar: null,
      deletedAt: null,
      productTagCount: 1,
      publishedAt: '2026-01-01T00:00:00Z',
      qualityScore: 0.5,
      viewsCount: 1,
      savesCount: 2,
      sharesCount: 0,
      productClicksCount: 0,
      heroThumbnailUrl: 'thumb',
      primaryMediaId: null,
      title: 'T',
      caption: null,
    } as unknown as Collection;
    const input = collectionToSearchIndexInput(c);
    assert.equal(input.collectionId, 'col-1');
    assert.equal(input.searchEligible, true);
    assert.equal(input.creator.creatorId, 'u1');
  });

  it('maps deleted/suspended User to ineligible Creator Search', () => {
    const u = {
      id: 'u1',
      username: 'alice',
      displayName: 'Alice',
      bio: null,
      profilePhotoUrl: null,
      followersCount: 0,
      schemaVersion: 1,
      accountStatus: 'DELETED',
      creatorStatus: 'ACTIVE',
      deletedAt: '2026-01-01T00:00:00Z',
    } as unknown as User;
    const input = userToCreatorIndexInput(u);
    assert.equal(input.searchEligible, false);
    assert.equal(input.deleted, true);
  });

  it('maps MERGED Catalog product to deleted Search product', () => {
    const p = {
      id: 'p1',
      canonicalSlug: 'slug',
      name: 'X',
      normalizedName: 'x',
      brand: null,
      model: null,
      category: null,
      imageUrl: null,
      status: 'MERGED',
      verificationStatus: 'UNVERIFIED',
      lastVerifiedAt: null,
      price: null,
      currency: null,
      mergedIntoId: 'p2',
    } as unknown as CatalogProduct;
    const input = catalogProductToSearchIndexInput(p);
    assert.equal(input.deleted, true);
    assert.equal(input.searchEligible, false);
  });

  it('maps ACTIVE Catalog product to searchable doc with denorm price', () => {
    const p = {
      id: 'p2',
      canonicalSlug: 'sony-xm5',
      name: 'Sony XM5',
      normalizedName: 'sony xm5',
      brand: 'Sony',
      model: 'XM5',
      category: 'headphones',
      imageUrl: null,
      status: 'ACTIVE',
      verificationStatus: 'VERIFIED',
      lastVerifiedAt: null,
      price: '299.99',
      currency: 'USD',
      mergedIntoId: null,
    } as unknown as CatalogProduct;
    const input = catalogProductToSearchIndexInput(p);
    assert.equal(input.searchEligible, true);
    assert.equal(input.priceAmount, 299.99);
    assert.equal(input.priceCurrency, 'USD');
  });
});
