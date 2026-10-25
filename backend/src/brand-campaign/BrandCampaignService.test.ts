import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CollectionService } from '../collection/CollectionService';
import { InMemoryCollectionRepository } from '../collection/InMemoryCollectionRepository';
import { InMemoryContentSourceRepository } from '../content-source/InMemoryContentSourceRepository';
import { InMemoryCreatorLibraryRepository } from '../creator-library/InMemoryCreatorLibraryRepository';
import { LibraryToCollectionService } from '../creator-library/LibraryToCollectionService';
import { resolveShoppingSelectionForProduct } from '../shopping/ShoppingConfiguration';
import { BrandCampaignService, type BrandFeedCatalogRow } from './BrandCampaignService';
import { InMemoryBrandCampaignRepository } from './InMemoryBrandCampaignRepository';
import { withCampaignBuyingUrl } from './campaignShopping';

function catalog() {
  const rows: BrandFeedCatalogRow[] = [
    {
      id: 'cat-existing',
      name: 'Lamp',
      brand: 'North',
      normalizedName: 'desk lamp',
      merchantUrl: 'https://shop.example/lamp',
    },
  ];
  return {
    rows,
    port: {
      async listIdentity() {
        return rows.map((row) => ({ ...row }));
      },
      async create(input: {
        name: string;
        normalizedName: string;
        brand: string | null;
        merchantUrl: string | null;
      }) {
        const row: BrandFeedCatalogRow = {
          id: `cat-${rows.length + 1}`,
          name: input.name,
          brand: input.brand,
          normalizedName: input.normalizedName,
          merchantUrl: input.merchantUrl,
        };
        rows.push(row);
        return row;
      },
    },
  };
}

describe('brand campaign foundation', () => {
  it('dedupes feed SKUs onto an existing catalog id and creates only new identities', async () => {
    const store = catalog();
    const svc = new BrandCampaignService(new InMemoryBrandCampaignRepository(), store.port);
    const brand = await svc.createBrand('North');
    const campaign = await svc.createCampaign({ brandId: brand.id, name: 'Spring' });
    const first = await svc.ingestFeed({
      brandId: brand.id,
      campaignId: campaign.id,
      items: [
        {
          sku: 'LAMP-1',
          name: 'Desk Lamp',
          brand: 'North',
          merchantUrl: 'https://shop.example/lamp',
          buyUrl: 'https://shop.example/lamp?ref=campaign',
        },
        {
          sku: 'CHAIR-1',
          name: 'Side Chair',
          brand: 'North',
          merchantUrl: 'https://shop.example/chair',
          buyUrl: 'https://shop.example/chair?ref=campaign',
        },
      ],
    });
    assert.equal(first.createdCount, 1);
    assert.equal(first.matchedCount, 1);
    assert.equal(store.rows.filter((row) => row.id === 'cat-existing').length, 1);

    const again = await svc.ingestFeed({
      brandId: brand.id,
      campaignId: campaign.id,
      items: [
        {
          sku: 'LAMP-1',
          name: 'Desk Lamp',
          brand: 'North',
          merchantUrl: 'https://shop.example/lamp',
          buyUrl: 'https://shop.example/lamp?ref=campaign',
        },
      ],
    });
    assert.equal(again.createdCount, 0);
    assert.equal(again.matchedCount, 1);
    assert.equal(store.rows.length, 2);
  });

  it('lists campaign products only for an eligible active creator', async () => {
    const store = catalog();
    const brands = new InMemoryBrandCampaignRepository();
    const svc = new BrandCampaignService(brands, store.port);
    const brand = await svc.createBrand('North');
    const open = await svc.createCampaign({ brandId: brand.id, name: 'Open' });
    const closed = await svc.createCampaign({
      brandId: brand.id,
      name: 'Private',
      eligibility: 'allowlist',
    });
    await svc.ingestFeed({
      brandId: brand.id,
      campaignId: open.id,
      items: [{ sku: 'NEW-1', name: 'New Mug', brand: 'North', merchantUrl: 'https://shop.example/mug' }],
    });
    await svc.ingestFeed({
      brandId: brand.id,
      campaignId: closed.id,
      items: [{ sku: 'HID-1', name: 'Hidden', brand: 'North', merchantUrl: 'https://shop.example/hidden' }],
    });
    await brands.allowlistCreator(closed.id, 'creator-allowed');

    const none = await svc.listEligibleOfferings({ userId: 'creator-1', creatorStatus: 'NONE' });
    assert.equal(none.length, 0);
    const active = await svc.listEligibleOfferings({ userId: 'creator-1', creatorStatus: 'ACTIVE' });
    assert.equal(active.length, 1);
    assert.equal(active[0]?.sku, 'NEW-1');
    const allowed = await svc.listEligibleOfferings({
      userId: 'creator-allowed',
      creatorStatus: 'ACTIVE',
    });
    assert.equal(allowed.length, 2);
  });

  it('attaches a campaign product as a collection tag on the same catalog id and still publishes with an extract tag', async () => {
    const store = catalog();
    const brands = new InMemoryBrandCampaignRepository();
    const sources = new Map();
    const library = new InMemoryCreatorLibraryRepository(sources);
    const content = new InMemoryContentSourceRepository();
    const svc = new BrandCampaignService(brands, store.port, library, content);
    const brand = await svc.createBrand('North');
    const campaign = await svc.createCampaign({ brandId: brand.id, name: 'Spring' });
    await svc.ingestFeed({
      brandId: brand.id,
      campaignId: campaign.id,
      items: [
        {
          sku: 'LAMP-1',
          name: 'Desk Lamp',
          brand: 'North',
          merchantUrl: 'https://shop.example/lamp',
          buyUrl: 'https://shop.example/lamp?ref=campaign',
        },
      ],
    });
    const [offering] = await svc.listEligibleOfferings({ userId: 'user-1', creatorStatus: 'ACTIVE' });
    assert.ok(offering);
    const source = await content.insert({
      platform: 'youtube',
      externalId: 'abcdefghijk',
      canonicalUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
      mediaKind: 'VIDEO',
      processingStatus: 'READY',
      pipelineVersion: 'test',
    });
    await library.upsertMembership({
      userId: 'user-1',
      connectedAccountId: 'acct-1',
      contentSourceId: source.id,
      availability: 'available',
      lastSeenAt: new Date().toISOString(),
    });
    const attached = await svc.attachOffering({
      userId: 'user-1',
      creatorStatus: 'ACTIVE',
      contentSourceId: source.id,
      campaignProductId: offering.id,
    });
    assert.equal(attached.catalogProductId, 'cat-existing');

    const collections = new CollectionService(new InMemoryCollectionRepository());
    const user = { id: 'user-1', email: 'a@b.com', user_metadata: { preferred_username: 'ada' } };
    const draft = await collections.createDraft({
      user,
      title: 'Mixed',
      originType: 'manual_curation',
    });
    await collections.addTag({
      collectionId: draft.id,
      userId: user.id,
      tag: {
        catalogProductId: 'cat-extract',
        selectionSource: 'AI_DETECTED',
        tagSource: 'ai',
        nameSnapshot: 'Extracted',
        resolutionStatus: 'UNVERIFIED',
        includeInPublish: true,
        externalId: 'extract',
      },
    });
    const bridge = new LibraryToCollectionService(library, content, collections);
    await bridge.addLibraryItem({
      user,
      contentSourceId: source.id,
      collectionId: draft.id,
    });
    const aggregate = await collections.getAggregate(draft.id);
    const campaignTag = aggregate?.tags.find((tag) => tag.catalogProductId === 'cat-existing');
    assert.equal(campaignTag?.selectionSource, 'BRAND_FEED');
    assert.equal(campaignTag?.campaignProductId, offering.id);
    assert.equal(campaignTag?.catalogProductId, attached.catalogProductId);
    const published = await collections.publish({
      collectionId: draft.id,
      userId: user.id,
      user,
      visibility: 'public',
    });
    assert.equal(published.status, 'published');
    const after = await collections.getAggregate(draft.id);
    assert.equal(after?.tags.filter((tag) => tag.includeInPublish && !tag.deletedAt).length, 2);
  });

  it('injects the campaign buy URL without changing another product override', () => {
    const base = {
      preferredMerchant: null,
      merchantPriority: ['amazon'],
      productOverrides: {
        'cat-other': { configuredBuyingUrl: 'https://shop.example/other', preferredMerchant: null },
      },
    };
    const next = withCampaignBuyingUrl(base, 'cat-existing', 'https://shop.example/lamp?ref=campaign');
    const resolved = resolveShoppingSelectionForProduct('cat-existing', null, { configuration: next });
    assert.equal(resolved.selection.configuredBuyingUrl, 'https://shop.example/lamp?ref=campaign');
    const other = resolveShoppingSelectionForProduct('cat-other', null, { configuration: next });
    assert.equal(other.selection.configuredBuyingUrl, 'https://shop.example/other');
  });
});
