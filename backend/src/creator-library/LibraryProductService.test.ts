import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InMemoryContentSourceRepository } from '../content-source/InMemoryContentSourceRepository';
import { InMemoryCreatorLibraryRepository } from './InMemoryCreatorLibraryRepository';
import { LibraryProductService } from './LibraryProductService';

const catalog = {
  name: 'Headphones',
  brand: 'Sony',
  model: 'XM5',
  category: 'audio',
  price: '299',
  currency: 'USD',
  image: null,
  merchantUrl: 'https://shop.example/xm5',
};

function harness() {
  const sources = new InMemoryContentSourceRepository();
  const library = new InMemoryCreatorLibraryRepository(sources.sources);
  const products = new Map<string, typeof catalog>([
    ['cat-1', catalog],
    ['cat-2', { ...catalog, name: 'Case' }],
  ]);
  const discovered = new Map<string, typeof catalog>([
    ['disc-1', { ...catalog, name: 'Discovered mug' }],
  ]);
  const service = new LibraryProductService(library, sources, {
    findCatalog: async (id) => products.get(id) ?? null,
    findDiscovered: async (id) => discovered.get(id) ?? null,
  });
  return { sources, library, service };
}

async function own(library: InMemoryCreatorLibraryRepository, sources: InMemoryContentSourceRepository) {
  const source = await sources.insert({
    platform: 'youtube',
    externalId: 'abcdefghijk',
    canonicalUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
    mediaKind: 'VIDEO',
    processingStatus: 'RECEIVED',
    pipelineVersion: 'test',
  });
  await library.upsertMembership({
    userId: 'user-1',
    connectedAccountId: 'acct-1',
    contentSourceId: source.id,
    availability: 'available',
    lastSeenAt: '2026-03-01T00:00:00.000Z',
  });
  return source;
}

describe('library item products', () => {
  it('rejects users who do not own the library item', async () => {
    const { sources, library, service } = harness();
    const source = await own(library, sources);
    await assert.rejects(() => service.list('other', source.id), /not found/i);
    await assert.rejects(
      () => service.attach('other', source.id, { catalogProductId: 'cat-1' }),
      /not found/i,
    );
  });

  it('attaches multiple catalog and discovered products idempotently', async () => {
    const { sources, library, service } = harness();
    const source = await own(library, sources);
    const first = await service.attach('user-1', source.id, { catalogProductId: 'cat-1' });
    const again = await service.attach('user-1', source.id, { catalogProductId: 'cat-1' });
    const second = await service.attach('user-1', source.id, { catalogProductId: 'cat-2' });
    const discovered = await service.attach('user-1', source.id, { discoveredProductId: 'disc-1' });
    assert.equal(first.created, true);
    assert.equal(again.created, false);
    assert.equal(again.product.id, first.product.id);
    assert.equal(first.product.attachmentSource, 'CREATOR_MANUAL');
    assert.equal(first.product.catalogProductId, 'cat-1');
    assert.equal(discovered.product.discoveredProductId, 'disc-1');
    const listed = await service.list('user-1', source.id);
    assert.equal(listed.length, 3);
    assert.equal(second.product.catalogProductId, 'cat-2');
  });

  it('removes only the creator attachment and keeps the product identity', async () => {
    const { sources, library, service } = harness();
    const source = await own(library, sources);
    const attached = await service.attach('user-1', source.id, { catalogProductId: 'cat-1' });
    await service.remove('user-1', source.id, attached.product.id);
    assert.equal((await service.list('user-1', source.id)).length, 0);
    await assert.rejects(() => service.attach('user-1', source.id, { catalogProductId: 'missing' }), /not found/i);
  });

  it('keeps creator attachments when extraction replaces candidates', async () => {
    const { sources, library, service } = harness();
    const source = await own(library, sources);
    await service.attach('user-1', source.id, { catalogProductId: 'cat-1' });
    await sources.replaceProducts(source.id, [
      {
        contentSourceId: source.id,
        position: 0,
        externalId: 'extract-1',
        name: 'Extracted',
        brand: null,
        model: null,
        category: null,
        price: null,
        currency: null,
        image: null,
        merchantUrl: null,
        confidence: 0.5,
        extractionMethod: 'ai_extract',
        sources: [],
        evidence: {},
        processorVersion: 'test',
      },
    ]);
    const listed = await service.list('user-1', source.id);
    assert.equal(listed.length, 2);
    assert.ok(listed.some((row) => row.attachmentSource === 'CREATOR_MANUAL'));
    assert.ok(listed.some((row) => row.extractionMethod === 'ai_extract'));
    const extracted = listed.find((row) => row.extractionMethod === 'ai_extract')!;
    await assert.rejects(() => service.remove('user-1', source.id, extracted.id), /creator-attached/i);
  });
});
