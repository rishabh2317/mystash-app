import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CollectionService } from '../collection/CollectionService';
import { InMemoryCollectionRepository } from '../collection/InMemoryCollectionRepository';
import { InMemoryContentSourceRepository } from '../content-source/InMemoryContentSourceRepository';
import { InMemoryCreatorLibraryRepository } from './InMemoryCreatorLibraryRepository';
import { LibraryToCollectionService } from './LibraryToCollectionService';

const user = { id: 'user-1', email: 'a@b.com', user_metadata: { preferred_username: 'alice' } };

async function setup() {
  const sources = new InMemoryContentSourceRepository();
  const library = new InMemoryCreatorLibraryRepository(sources.sources);
  const collections = new CollectionService(new InMemoryCollectionRepository());
  const service = new LibraryToCollectionService(library, sources, collections);
  const source = await sources.insert({
    platform: 'youtube',
    externalId: 'abcdefghijk',
    canonicalUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
    mediaKind: 'VIDEO',
    processingStatus: 'RECEIVED',
    pipelineVersion: 'test',
  });
  await sources.patchDisplay(source.id, { title: 'Short', thumbnailUrl: 'https://img.test/a.jpg' });
  await library.upsertMembership({
    userId: user.id,
    connectedAccountId: 'acct-1',
    contentSourceId: source.id,
    availability: 'available',
    lastSeenAt: '2026-03-01T00:00:00.000Z',
  });
  await sources.insertProduct({
    contentSourceId: source.id,
    position: 0,
    externalId: 'catalog:cat-1',
    name: 'Headphones',
    brand: 'Sony',
    model: null,
    category: null,
    price: null,
    currency: null,
    image: null,
    merchantUrl: 'https://shop.example/a',
    confidence: null,
    extractionMethod: 'creator_manual',
    sources: [],
    evidence: {},
    processorVersion: 'test',
    catalogProductId: 'cat-1',
    attachmentSource: 'CREATOR_MANUAL',
  });
  await sources.insertProduct({
    contentSourceId: source.id,
    position: 1,
    externalId: 'discovered:disc-1',
    name: 'Mug',
    brand: null,
    model: null,
    category: null,
    price: null,
    currency: null,
    image: null,
    merchantUrl: null,
    confidence: null,
    extractionMethod: 'creator_manual',
    sources: [],
    evidence: {},
    processorVersion: 'test',
    discoveredProductId: 'disc-1',
    attachmentSource: 'CREATOR_MANUAL',
  });
  return { sources, library, collections, service, source };
}

describe('library item to collection', () => {
  it('rejects a user who does not own the library item or collection', async () => {
    const { service, source, collections } = await setup();
    await assert.rejects(
      () => service.addLibraryItem({ user: { id: 'other' }, contentSourceId: source.id }),
      /not found/i,
    );
    const foreign = await collections.createDraft({
      user: { id: 'other', email: 'o@b.com' },
      originType: 'manual_curation',
      title: 'Theirs',
    });
    await assert.rejects(
      () =>
        service.addLibraryItem({
          user,
          contentSourceId: source.id,
          collectionId: foreign.id,
        }),
      /not found/i,
    );
  });

  it('creates a collection, copies media and both product identities, and is idempotent', async () => {
    const { service, source, collections } = await setup();
    const first = await service.addLibraryItem({ user, contentSourceId: source.id, title: 'From library' });
    const second = await service.addLibraryItem({
      user,
      contentSourceId: source.id,
      collectionId: first.collectionId,
    });
    assert.equal(first.createdCollection, true);
    assert.equal(second.createdCollection, false);
    assert.equal(second.attachedProducts, 0);
    const aggregate = await collections.getAggregate(first.collectionId);
    assert.equal(aggregate?.media.length, 1);
    assert.equal(aggregate?.media[0]?.externalId, 'abcdefghijk');
    assert.equal(aggregate?.media[0]?.sourceProvider, 'youtube');
    assert.equal(aggregate?.tags.length, 2);
    assert.ok(aggregate?.tags.some((tag) => tag.catalogProductId === 'cat-1'));
    assert.ok(aggregate?.tags.some((tag) => tag.discoveredProductId === 'disc-1'));
    const discovered = aggregate?.tags.find((tag) => tag.discoveredProductId === 'disc-1');
    assert.equal(discovered?.includeInPublish, false);
    assert.equal(discovered?.catalogProductId, null);
  });

  it('adds the same item to an existing collection and publishes through the existing flow', async () => {
    const { service, source, collections } = await setup();
    const existing = await collections.createDraft({
      user,
      originType: 'manual_curation',
      title: 'Existing',
    });
    const added = await service.addLibraryItem({
      user,
      contentSourceId: source.id,
      collectionId: existing.id,
    });
    assert.equal(added.createdCollection, false);
    assert.equal(added.collectionId, existing.id);
    const published = await collections.publish({ collectionId: existing.id, userId: user.id, user });
    assert.equal(published.status, 'published');
    const aggregate = await collections.getAggregate(existing.id);
    assert.equal(aggregate?.media.length, 1);
    assert.equal(aggregate?.tags.filter((tag) => tag.catalogProductId).length, 1);
  });
});
