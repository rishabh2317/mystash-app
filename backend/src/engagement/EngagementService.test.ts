import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { EngagementService, EngagementServiceError } from './EngagementService';
import { InMemoryEngagementRepository } from './InMemoryEngagementRepository';
import type {
  CollectionCounterDenormPort,
  ReelEligibilityPort,
  UserCounterDenormPort,
} from './ports';

const eligibleReels: ReelEligibilityPort = {
  async getEligiblePublicReel(reelId) {
    if (reelId === 'deleted-reel' || reelId === 'unpublished-reel') return null;
    return {
      reelId,
      collectionId: `collection-${reelId}`,
      creatorId: 'creator-1',
    };
  },
};

describe('EngagementService', () => {
  it('records collection view idempotently and denorms views', async () => {
    const repo = new InMemoryEngagementRepository();
    const denorm: Record<string, number> = {};
    const collections: CollectionCounterDenormPort = {
      async applyCollectionCounters(id, c) {
        if (c.viewsCount !== undefined) denorm[`${id}:views`] = c.viewsCount;
      },
    };
    const svc = new EngagementService(repo, collections);
    const eventId = randomUUID();
    await svc.recordCollectionView({
      eventId,
      collectionId: 'col-1',
      actorUserId: 'user-1',
    });
    await svc.recordCollectionView({
      eventId,
      collectionId: 'col-1',
      actorUserId: 'user-1',
    });
    assert.equal(repo.facts.size, 1);
    assert.equal(denorm['col-1:views'], 1);
    const counter = await repo.getCounter({
      objectType: 'collection',
      objectId: 'col-1',
      counterName: 'views',
    });
    assert.equal(counter?.value, 1);
  });

  it('distinguishes impression from view (no view counter on impression)', async () => {
    const repo = new InMemoryEngagementRepository();
    const svc = new EngagementService(repo);
    await svc.recordCollectionImpression({
      eventId: randomUUID(),
      collectionId: 'col-1',
      anonymousId: 'anon-1',
    });
    const counter = await repo.getCounter({
      objectType: 'collection',
      objectId: 'col-1',
      counterName: 'views',
    });
    assert.equal(counter, null);
  });

  it('records collection share idempotently and denorms shares', async () => {
    const repo = new InMemoryEngagementRepository();
    const denorm: Record<string, number> = {};
    const collections: CollectionCounterDenormPort = {
      async applyCollectionCounters(id, c) {
        if (c.sharesCount !== undefined) denorm[`${id}:shares`] = c.sharesCount;
      },
    };
    const svc = new EngagementService(repo, collections);
    const eventId = randomUUID();
    await svc.recordCollectionShare({
      eventId,
      collectionId: 'col-1',
      actorUserId: 'user-1',
      creatorId: 'creator-1',
    });
    await svc.recordCollectionShare({
      eventId,
      collectionId: 'col-1',
      actorUserId: 'user-1',
      creatorId: 'creator-1',
    });
    assert.equal(repo.facts.size, 1);
    assert.equal(denorm['col-1:shares'], 1);
    const counter = await repo.getCounter({
      objectType: 'collection',
      objectId: 'col-1',
      counterName: 'shares',
    });
    assert.equal(counter?.value, 1);
  });

  it('records creator profile share on creator object without collection denorm', async () => {
    const repo = new InMemoryEngagementRepository();
    const denorm: Record<string, number> = {};
    const collections: CollectionCounterDenormPort = {
      async applyCollectionCounters(id, c) {
        if (c.sharesCount !== undefined) denorm[`${id}:shares`] = c.sharesCount;
      },
    };
    const svc = new EngagementService(repo, collections);
    const eventId = randomUUID();
    const fact = await svc.recordCreatorShare({
      eventId,
      creatorId: 'creator-1',
      actorUserId: 'user-1',
      surface: 'creator_profile',
    });
    await svc.recordCreatorShare({
      eventId,
      creatorId: 'creator-1',
      actorUserId: 'user-1',
    });
    assert.equal(fact.interactionType, 'share');
    assert.equal(fact.objectType, 'creator');
    assert.equal(fact.objectId, 'creator-1');
    assert.equal(fact.creatorId, 'creator-1');
    assert.equal(repo.facts.size, 1);
    assert.equal(Object.keys(denorm).length, 0);
    const counter = await repo.getCounter({
      objectType: 'creator',
      objectId: 'creator-1',
      counterName: 'shares',
    });
    assert.equal(counter?.value, 1);
  });

  it('follows creator and updates follower counters', async () => {
    const repo = new InMemoryEngagementRepository();
    const userDenorm: Record<string, number> = {};
    const users: UserCounterDenormPort = {
      async applyUserCounters(id, c) {
        if (c.followersCount !== undefined) userDenorm[`${id}:followers`] = c.followersCount;
        if (c.followingCount !== undefined) userDenorm[`${id}:following`] = c.followingCount;
      },
    };
    const svc = new EngagementService(repo, undefined, users);
    await svc.followCreator({ userId: 'u1', creatorId: 'c1' });
    await svc.followCreator({ userId: 'u1', creatorId: 'c1' }); // idempotent edge
    assert.equal(userDenorm['c1:followers'], 1);
    assert.equal(userDenorm['u1:following'], 1);
    assert.equal(await svc.isFollowing('u1', 'c1'), true);
    await svc.unfollowCreator({ userId: 'u1', creatorId: 'c1' });
    assert.equal(await svc.isFollowing('u1', 'c1'), false);
    assert.equal(userDenorm['c1:followers'], 0);
  });

  it('saves collection without Like', async () => {
    const repo = new InMemoryEngagementRepository();
    const denorm: Record<string, number> = {};
    const collections: CollectionCounterDenormPort = {
      async applyCollectionCounters(id, c) {
        if (c.savesCount !== undefined) denorm[`${id}:saves`] = c.savesCount;
      },
    };
    const svc = new EngagementService(repo, collections);
    await svc.saveCollection({ userId: 'u1', collectionId: 'col-1' });
    assert.equal(denorm['col-1:saves'], 1);
    const saves = await svc.listSavedCollections('u1');
    assert.equal(saves.length, 1);
    await svc.unsaveCollection({ userId: 'u1', collectionId: 'col-1' });
    assert.equal(denorm['col-1:saves'], 0);
  });

  it('likes and unlikes a Reel independently and reports current user state', async () => {
    const repo = new InMemoryEngagementRepository();
    const svc = new EngagementService(repo, undefined, undefined, eligibleReels);

    assert.deepEqual(await svc.getReelLikeSummary('reel-1', 'u1'), {
      liked: false,
      likeCount: 0,
    });
    assert.deepEqual(await svc.likeReel({ userId: 'u1', reelId: 'reel-1' }), {
      liked: true,
      likeCount: 1,
    });
    assert.deepEqual(await svc.getReelLikeSummary('reel-1', 'u1'), {
      liked: true,
      likeCount: 1,
    });
    assert.deepEqual(await svc.unlikeReel({ userId: 'u1', reelId: 'reel-1' }), {
      liked: false,
      likeCount: 0,
    });
    assert.deepEqual(await svc.unlikeReel({ userId: 'u1', reelId: 'reel-1' }), {
      liked: false,
      likeCount: 0,
    });
  });

  it('protects against duplicate Reel likes and counts distinct users', async () => {
    const repo = new InMemoryEngagementRepository();
    const svc = new EngagementService(repo, undefined, undefined, eligibleReels);

    await svc.likeReel({ userId: 'u1', reelId: 'reel-1' });
    await svc.likeReel({ userId: 'u1', reelId: 'reel-1' });
    const afterSecondUser = await svc.likeReel({ userId: 'u2', reelId: 'reel-1' });
    assert.equal(afterSecondUser.likeCount, 2);
    assert.equal(
      [...repo.edges.values()].filter(
        (edge) =>
          edge.edgeType === 'LIKE' &&
          edge.objectType === 'reel' &&
          edge.objectId === 'reel-1' &&
          edge.state === 'ACTIVE',
      ).length,
      2,
    );
    assert.equal(
      [...repo.facts.values()].filter((fact) => fact.interactionType === 'like').length,
      2,
    );
  });

  it('does not Like deleted or unpublished Reels', async () => {
    const svc = new EngagementService(
      new InMemoryEngagementRepository(),
      undefined,
      undefined,
      eligibleReels,
    );
    await assert.rejects(
      () => svc.likeReel({ userId: 'u1', reelId: 'deleted-reel' }),
      (error: unknown) =>
        error instanceof EngagementServiceError && error.statusCode === 404,
    );
    await assert.rejects(
      () => svc.getReelLikeSummary('unpublished-reel', 'u1'),
      (error: unknown) =>
        error instanceof EngagementServiceError && error.statusCode === 404,
    );
  });

  it('records MerchantClicked with tag-primary attribution dims', async () => {
    const repo = new InMemoryEngagementRepository();
    const denorm: Record<string, number> = {};
    const collections: CollectionCounterDenormPort = {
      async applyCollectionCounters(id, c) {
        if (c.productClicksCount !== undefined) {
          denorm[`${id}:clicks`] = c.productClicksCount;
        }
      },
    };
    const svc = new EngagementService(repo, collections);
    const fact = await svc.recordMerchantClicked({
      catalogProductId: 'cat-1',
      collectionId: 'col-1',
      collectionProductTagId: 'tag-1',
      creatorId: 'creator-1',
      destinationUrl: 'https://shop.example/p',
      destinationType: 'preferred',
      actorUserId: 'u1',
    });
    assert.equal(fact.interactionType, 'merchant_click');
    assert.equal(fact.collectionProductTagId, 'tag-1');
    assert.equal(fact.catalogProductId, 'cat-1');
    assert.equal(denorm['col-1:clicks'], 1);
  });

  it('rejects follow self', async () => {
    const svc = new EngagementService(new InMemoryEngagementRepository());
    await assert.rejects(() => svc.followCreator({ userId: 'u1', creatorId: 'u1' }));
  });
});
