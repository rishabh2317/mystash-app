import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CollectionService, CollectionServiceError } from './CollectionService';
import { InMemoryCollectionRepository } from './InMemoryCollectionRepository';

describe('CollectionService', () => {
  const user = {
    id: 'user-1',
    email: 'a@b.com',
    user_metadata: { preferred_username: 'alice', full_name: 'Alice' },
  };

  it('creates draft with creator snapshot and starts processing', async () => {
    const repo = new InMemoryCollectionRepository();
    const svc = new CollectionService(repo);
    const draft = await svc.createDraft({
      user,
      title: 'Test Short',
      originType: 'url_ingest',
      originPlatform: 'youtube',
      originSourceUrl: 'https://youtube.com/shorts/abc',
    });
    assert.equal(draft.status, 'draft');
    assert.equal(draft.creatorUsername, 'alice');
    assert.ok(draft.slug.length > 0);

    const media = await svc.attachPrimaryExternalSource({
      collectionId: draft.id,
      userId: user.id,
      sourceUrl: 'https://www.youtube.com/shorts/abcdefghijk',
      thumbnailUrl: 'https://img.example/t.jpg',
      title: 'Test Short',
    });
    assert.equal(media.processingStatus, 'imported');
    assert.equal(media.sourceProvider, 'youtube');
    assert.equal(media.isPrimary, true);

    const processing = await svc.startProcessing({
      collectionId: draft.id,
      userId: user.id,
      ingestRunId: 'ingest-1',
    });
    assert.equal(processing.status, 'processing');
    assert.equal(processing.latestIngestRunId, 'ingest-1');
  });

  it('keeps separate media rows for the same external id across collections', async () => {
    const repo = new InMemoryCollectionRepository();
    const svc = new CollectionService(repo);
    const a = await svc.createDraft({ user, originType: 'url_ingest', title: 'A' });
    const b = await svc.createDraft({
      user: { ...user, id: 'user-2' },
      originType: 'url_ingest',
      title: 'B',
    });
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const mediaA = await svc.attachPrimaryExternalSource({
      collectionId: a.id,
      userId: user.id,
      sourceUrl: url,
    });
    const mediaB = await svc.attachPrimaryExternalSource({
      collectionId: b.id,
      userId: 'user-2',
      sourceUrl: url,
    });
    assert.notEqual(mediaA.id, mediaB.id);
    assert.equal(mediaA.externalId, mediaB.externalId);
    assert.equal(mediaA.collectionId, a.id);
    assert.equal(mediaB.collectionId, b.id);
  });

  it('syncs provider creator id and name', async () => {
    const repo = new InMemoryCollectionRepository();
    const svc = new CollectionService(repo);
    const draft = await svc.createDraft({ user, originType: 'url_ingest' });
    await svc.attachPrimaryExternalSource({
      collectionId: draft.id,
      userId: user.id,
      sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
    const synced = await svc.syncMediaMetadata({
      collectionId: draft.id,
      providerCreatorId: 'UCxxxxxxxx',
      providerCreatorName: 'Marques Brownlee',
      title: 'Review',
    });
    assert.equal(synced.providerCreatorId, 'UCxxxxxxxx');
    assert.equal(synced.providerCreatorName, 'Marques Brownlee');
    assert.equal(synced.title, 'Review');
  });

  it('runs media processing lifecycle to ready', async () => {
    const repo = new InMemoryCollectionRepository();
    const svc = new CollectionService(repo);
    const draft = await svc.createDraft({ user, originType: 'url_ingest' });
    await svc.attachPrimaryExternalSource({
      collectionId: draft.id,
      userId: user.id,
      sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
    await svc.startMediaProcessing({ collectionId: draft.id, jobId: 'job-1' });
    const ready = await svc.completeMediaProcessing({
      collectionId: draft.id,
      jobId: 'job-1',
      artifactBundleRef: 'job-1',
    });
    assert.equal(ready.processingStatus, 'ready');
    assert.equal(ready.latestArtifactBundleRef, 'job-1');
  });

  it('retries media processing after failure (failed → processing)', async () => {
    const repo = new InMemoryCollectionRepository();
    const svc = new CollectionService(repo);
    const draft = await svc.createDraft({ user, originType: 'url_ingest' });
    await svc.attachPrimaryExternalSource({
      collectionId: draft.id,
      userId: user.id,
      sourceUrl: 'https://www.instagram.com/reel/AbC123xyz/',
    });
    await svc.startMediaProcessing({ collectionId: draft.id, jobId: 'job-fail' });
    const failed = await svc.failMediaProcessing({
      collectionId: draft.id,
      jobId: 'job-fail',
      errorCode: 'SOURCE_RESTRICTED',
    });
    assert.equal(failed.processingStatus, 'failed');
    const retried = await svc.startMediaProcessing({ collectionId: draft.id, jobId: 'job-retry' });
    assert.equal(retried.processingStatus, 'processing');
    assert.equal(retried.lastProcessingErrorCode, null);
  });

  it('applies ingest result and publishes with dual eligibility', async () => {
    const repo = new InMemoryCollectionRepository();
    const svc = new CollectionService(repo);
    const draft = await svc.createDraft({
      user,
      title: 'Phone Review',
      originType: 'url_ingest',
      originPlatform: 'youtube',
      originSourceUrl: 'https://youtube.com/shorts/x',
      status: 'processing',
    });

    await svc.applyIngestResult({
      collectionId: draft.id,
      status: 'ready_for_review',
      title: 'Phone Review',
      proposedTags: [
        {
          collectionId: draft.id,
          tagSource: 'ai',
          externalId: 'p_0',
          nameSnapshot: 'Galaxy Z Fold',
          brandSnapshot: 'Samsung',
          categorySnapshot: 'Phones',
          catalogProductId: 'cat-fold',
          resolutionStatus: 'VERIFIED',
          includeInPublish: true,
        },
      ],
      recommendationIntent: 'review',
      recommendationIntentConfidence: 0.8,
    });

    const published = await svc.publish({
      collectionId: draft.id,
      userId: user.id,
      user,
      includeExternalIds: ['p_0'],
    });

    assert.equal(published.status, 'published');
    assert.equal(published.visibility, 'public');
    assert.equal(published.feedEligible, true);
    assert.equal(published.recommendationIntent, 'review');
    assert.equal(published.searchTitle, 'Phone Review');
    assert.ok(published.searchBrands.includes('Samsung'));
  });

  it('rejects publish with zero included tags', async () => {
    const repo = new InMemoryCollectionRepository();
    const svc = new CollectionService(repo);
    const draft = await svc.createDraft({
      user,
      originType: 'manual_curation',
      status: 'ready_for_review',
    });
    await assert.rejects(
      () => svc.publish({ collectionId: draft.id, userId: user.id }),
      /at least one product/i,
    );
  });

  it('updates materialized counters via contract', async () => {
    const repo = new InMemoryCollectionRepository();
    const svc = new CollectionService(repo);
    const draft = await svc.createDraft({ user, originType: 'url_ingest' });
    await svc.updateMaterializedCounters(draft.id, { viewsCount: 10, likesCount: 2 });
    const c = await repo.getCollection(draft.id);
    assert.equal(c?.viewsCount, 10);
    assert.equal(c?.likesCount, 2);
  });

  it('hides non-owner drafts from public read', async () => {
    const repo = new InMemoryCollectionRepository();
    const svc = new CollectionService(repo);
    const draft = await svc.createDraft({ user, originType: 'url_ingest' });
    assert.equal(svc.canRead(draft, null), false);
    assert.equal(svc.canRead(draft, user.id), true);
  });

  it('lists published public collections by creator with eligibility + pagination', async () => {
    const repo = new InMemoryCollectionRepository();
    const svc = new CollectionService(repo);
    const creator = {
      ...user,
      id: '11111111-1111-4111-8111-111111111111',
    };

    async function publishOne(title: string) {
      const draft = await svc.createDraft({
        user: creator,
        title,
        originType: 'url_ingest',
        status: 'processing',
      });
      await svc.applyIngestResult({
        collectionId: draft.id,
        status: 'ready_for_review',
        title,
        proposedTags: [
          {
            collectionId: draft.id,
            tagSource: 'ai',
            externalId: `ext-${title}`,
            nameSnapshot: title,
            brandSnapshot: null,
            categorySnapshot: null,
            catalogProductId: `cat-${title}`,
            resolutionStatus: 'VERIFIED',
            includeInPublish: true,
          },
        ],
      });
      return svc.publish({
        collectionId: draft.id,
        userId: creator.id,
        user: creator,
        includeExternalIds: [`ext-${title}`],
      });
    }

    const a = await publishOne('Alpha');
    const b = await publishOne('Beta');
    const c = await publishOne('Gamma');

    // Force distinct publishedAt for stable ordering
    await repo.updateCollection(a.id, { publishedAt: '2026-01-01T00:00:00.000Z' });
    await repo.updateCollection(b.id, { publishedAt: '2026-01-02T00:00:00.000Z' });
    await repo.updateCollection(c.id, { publishedAt: '2026-01-03T00:00:00.000Z' });

    const draft = await svc.createDraft({
      user: creator,
      title: 'Draft',
      originType: 'manual_curation',
    });
    await repo.updateCollection(draft.id, {
      status: 'draft',
      visibility: 'private',
    });
    const privatePub = await publishOne('Private');
    await repo.updateCollection(privatePub.id, { visibility: 'private' });
    const deleted = await publishOne('Deleted');
    await repo.updateCollection(deleted.id, { deletedAt: new Date().toISOString() });

    const page1 = await svc.listPublishedPublicByCreator(creator.id, { limit: 2 });
    assert.equal(page1.collections.length, 2);
    assert.equal(page1.collections[0]!.title, 'Gamma');
    assert.equal(page1.collections[1]!.title, 'Beta');
    assert.ok(page1.nextCursor);

    const page2 = await svc.listPublishedPublicByCreator(creator.id, {
      limit: 2,
      cursor: page1.nextCursor,
    });
    assert.equal(page2.collections.length, 1);
    assert.equal(page2.collections[0]!.title, 'Alpha');
    assert.equal(page2.nextCursor, null);

    const titles = [...page1.collections, ...page2.collections].map((x) => x.title);
    assert.ok(!titles.includes('Draft'));
    assert.ok(!titles.includes('Private'));
    assert.ok(!titles.includes('Deleted'));

    const empty = await svc.listPublishedPublicByCreator(
      '00000000-0000-4000-8000-000000000099',
      { limit: 10 },
    );
    assert.deepEqual(empty.collections, []);
    assert.equal(empty.nextCursor, null);

    await assert.rejects(
      () => svc.listPublishedPublicByCreator('not-a-uuid'),
      /creator_id must be a valid UUID/i,
    );
  });

  it('rejects draft when creator gate forbids create', async () => {
    const { UserServiceError } = await import('../user/UserService');
    const repo = new InMemoryCollectionRepository();
    const svc = new CollectionService(repo, {
      async assertCanCreateCollections() {
        throw new UserServiceError('Creator status ACTIVE required to create Collections', 403);
      },
      async getCreatorSnapshot() {
        return null;
      },
    });
    await assert.rejects(
      () => svc.createDraft({ user, originType: 'url_ingest', title: 'Nope' }),
      (e: unknown) => e instanceof CollectionServiceError && e.statusCode === 403,
    );
  });
});
