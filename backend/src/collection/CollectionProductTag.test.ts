import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CollectionService, CollectionServiceError } from './CollectionService';
import { InMemoryCollectionRepository } from './InMemoryCollectionRepository';

describe('CollectionProductTag domain', () => {
  const user = {
    id: 'user-1',
    email: 'a@b.com',
    user_metadata: { preferred_username: 'alice', full_name: 'Alice' },
  };

  async function draftWithTags() {
    const repo = new InMemoryCollectionRepository();
    const svc = new CollectionService(repo);
    const collection = await svc.createDraft({ user, originType: 'url_ingest', title: 'T' });
    await svc.applyIngestResult({
      collectionId: collection.id,
      status: 'ready_for_review',
      proposedTags: [
        {
          collectionId: collection.id,
          selectionSource: 'AI_DETECTED',
          tagSource: 'ai',
          nameSnapshot: 'Earbuds',
          catalogProductId: 'cat-1',
          resolutionStatus: 'VERIFIED',
          recommendationStrength: 'PRIMARY',
          includeInPublish: true,
        },
        {
          collectionId: collection.id,
          selectionSource: 'AI_DETECTED',
          tagSource: 'ai',
          nameSnapshot: 'Case',
          catalogProductId: 'cat-2',
          resolutionStatus: 'VERIFIED',
          recommendationStrength: 'SECONDARY',
          includeInPublish: true,
        },
      ],
    });
    return { repo, svc, collection };
  }

  it('proposes AI tags with selection_source and strength', async () => {
    const { repo, collection } = await draftWithTags();
    const tags = await repo.listTags(collection.id);
    assert.equal(tags.length, 2);
    assert.equal(tags[0]!.selectionSource, 'AI_DETECTED');
    assert.equal(tags[0]!.recommendationStrength, 'PRIMARY');
    assert.equal(tags[0]!.isPrimary, true);
    assert.equal(tags[0]!.tagStatus, 'proposed');
  });

  it('accepts and rejects tags with timestamps', async () => {
    const { svc, repo, collection } = await draftWithTags();
    const tags = await repo.listTags(collection.id);
    const accepted = await svc.acceptTag({
      collectionId: collection.id,
      userId: user.id,
      tagId: tags[0]!.id,
    });
    assert.equal(accepted.tagStatus, 'accepted');
    assert.equal(accepted.selectionSource, 'CREATOR_ACCEPTED_AI');
    assert.ok(accepted.acceptedAt);

    const rejected = await svc.rejectTag({
      collectionId: collection.id,
      userId: user.id,
      tagId: tags[1]!.id,
      reason: 'wrong product',
    });
    assert.equal(rejected.tagStatus, 'rejected');
    assert.equal(rejected.includeInPublish, false);
    assert.ok(rejected.rejectedAt);
  });

  it('stores creator_note and enforces single PRIMARY', async () => {
    const { svc, repo, collection } = await draftWithTags();
    const tags = await repo.listTags(collection.id);
    await svc.acceptTag({ collectionId: collection.id, userId: user.id, tagId: tags[0]!.id });
    await svc.acceptTag({ collectionId: collection.id, userId: user.id, tagId: tags[1]!.id });

    const updated = await svc.updateTag({
      collectionId: collection.id,
      userId: user.id,
      tagId: tags[1]!.id,
      patch: {
        creatorNote: 'Best value under 10k',
        recommendationStrength: 'PRIMARY',
      },
    });
    assert.equal(updated.creatorNote, 'Best value under 10k');
    assert.equal(updated.recommendationStrength, 'PRIMARY');

    const after = await repo.listTags(collection.id);
    const primaries = after.filter((t) => t.recommendationStrength === 'PRIMARY');
    assert.equal(primaries.length, 1);
    assert.equal(primaries[0]!.id, tags[1]!.id);
  });

  it('blocks publish without resolved catalog ids', async () => {
    const repo = new InMemoryCollectionRepository();
    const svc = new CollectionService(repo);
    const collection = await svc.createDraft({ user, originType: 'url_ingest', title: 'T' });
    await svc.applyIngestResult({
      collectionId: collection.id,
      status: 'ready_for_review',
      proposedTags: [
        {
          collectionId: collection.id,
          selectionSource: 'AI_DETECTED',
          nameSnapshot: 'Unresolved',
          catalogProductId: null,
          includeInPublish: true,
          recommendationStrength: 'PRIMARY',
        },
      ],
    });
    const tags = await repo.listTags(collection.id);
    await svc.acceptTag({ collectionId: collection.id, userId: user.id, tagId: tags[0]!.id });
    await assert.rejects(
      () => svc.publish({ collectionId: collection.id, userId: user.id, user }),
      (e: unknown) => e instanceof CollectionServiceError && e.statusCode === 400,
    );
  });

  it('blocks publish of UNRESOLVED tags even when a catalog placeholder id exists', async () => {
    const repo = new InMemoryCollectionRepository();
    const svc = new CollectionService(repo);
    const collection = await svc.createDraft({ user, originType: 'url_ingest', title: 'T' });
    await svc.applyIngestResult({
      collectionId: collection.id,
      status: 'ready_for_review',
      proposedTags: [
        {
          collectionId: collection.id,
          selectionSource: 'AI_DETECTED',
          nameSnapshot: 'Still unresolved',
          catalogProductId: 'placeholder-cat',
          resolutionStatus: 'UNRESOLVED',
          includeInPublish: true,
          recommendationStrength: 'PRIMARY',
        },
      ],
    });
    const tags = await repo.listTags(collection.id);
    await svc.acceptTag({ collectionId: collection.id, userId: user.id, tagId: tags[0]!.id });
    await assert.rejects(
      () => svc.publish({ collectionId: collection.id, userId: user.id, user }),
      (e: unknown) => e instanceof CollectionServiceError && e.statusCode === 400,
    );
  });

  it('blocks publish while a selected product is still processing (no terminal resolution)', async () => {
    const repo = new InMemoryCollectionRepository();
    const svc = new CollectionService(repo);
    const collection = await svc.createDraft({ user, originType: 'url_ingest', title: 'T' });
    await svc.applyIngestResult({
      collectionId: collection.id,
      status: 'ready_for_review',
      proposedTags: [
        {
          collectionId: collection.id,
          selectionSource: 'AI_DETECTED',
          nameSnapshot: 'Processing',
          catalogProductId: 'cat-processing',
          resolutionStatus: null,
          includeInPublish: true,
          recommendationStrength: 'PRIMARY',
        },
      ],
    });
    const tags = await repo.listTags(collection.id);
    await svc.acceptTag({ collectionId: collection.id, userId: user.id, tagId: tags[0]!.id });
    await assert.rejects(
      () => svc.publish({ collectionId: collection.id, userId: user.id, user }),
      (e: unknown) => e instanceof CollectionServiceError && e.statusCode === 400,
    );
  });

  it('publishes UNVERIFIED tags that already have a catalog identity', async () => {
    const repo = new InMemoryCollectionRepository();
    const svc = new CollectionService(repo);
    const collection = await svc.createDraft({ user, originType: 'url_ingest', title: 'T' });
    await svc.applyIngestResult({
      collectionId: collection.id,
      status: 'ready_for_review',
      proposedTags: [
        {
          collectionId: collection.id,
          selectionSource: 'CREATOR_MANUAL',
          nameSnapshot: 'Unverified but catalogued',
          catalogProductId: 'cat-unverified',
          resolutionStatus: 'UNVERIFIED',
          includeInPublish: true,
          recommendationStrength: 'PRIMARY',
        },
      ],
    });
    const tags = await repo.listTags(collection.id);
    await svc.acceptTag({ collectionId: collection.id, userId: user.id, tagId: tags[0]!.id });
    const published = await svc.publish({
      collectionId: collection.id,
      userId: user.id,
      user,
    });
    assert.equal(published.status, 'published');
  });

  it('publishes resolved tags and sets first_published_at', async () => {
    const { svc, repo, collection } = await draftWithTags();
    const tags = await repo.listTags(collection.id);
    for (const t of tags) {
      await svc.acceptTag({ collectionId: collection.id, userId: user.id, tagId: t.id });
    }
    const published = await svc.publish({
      collectionId: collection.id,
      userId: user.id,
      user,
    });
    assert.equal(published.status, 'published');
    assert.equal(published.productTagCount, 2);
    const after = await repo.listTags(collection.id);
    assert.ok(after.every((t) => t.firstPublishedAt));
    assert.ok(after.every((t) => t.tagStatus === 'published'));
  });

  it('soft-deletes tags and excludes from count', async () => {
    const { svc, repo, collection } = await draftWithTags();
    const tags = await repo.listTags(collection.id);
    await svc.removeTag({ collectionId: collection.id, userId: user.id, tagId: tags[1]!.id });
    const listed = await repo.listTags(collection.id);
    assert.equal(listed.length, 1);
    const deleted = await repo.listTags(collection.id, { includeDeleted: true });
    assert.equal(deleted.filter((t) => t.tagStatus === 'deleted').length, 1);
    const c = await repo.getCollection(collection.id);
    assert.equal(c?.productTagCount, 1);
  });

  it('is idempotent for the same collection + catalogProductId', async () => {
    const { svc, repo, collection } = await draftWithTags();
    const first = await repo.listTags(collection.id);
    assert.equal(first.length, 2);
    const firstIds = first.map((t) => t.id).sort();

    await svc.applyIngestResult({
      collectionId: collection.id,
      status: 'ready_for_review',
      proposedTags: [
        {
          collectionId: collection.id,
          selectionSource: 'CREATOR_MANUAL',
          tagSource: 'manual',
          nameSnapshot: 'Earbuds refreshed',
          catalogProductId: 'cat-1',
          resolutionStatus: 'VERIFIED',
          recommendationStrength: 'PRIMARY',
          includeInPublish: true,
        },
        {
          collectionId: collection.id,
          selectionSource: 'CREATOR_MANUAL',
          tagSource: 'manual',
          nameSnapshot: 'Case refreshed',
          catalogProductId: 'cat-2',
          resolutionStatus: 'VERIFIED',
          recommendationStrength: 'SECONDARY',
          includeInPublish: true,
        },
      ],
    });

    const second = await repo.listTags(collection.id);
    assert.equal(second.length, 2);
    assert.deepEqual(second.map((t) => t.id).sort(), firstIds);
    assert.equal(second.find((t) => t.catalogProductId === 'cat-1')?.nameSnapshot, 'Earbuds refreshed');
  });
});
