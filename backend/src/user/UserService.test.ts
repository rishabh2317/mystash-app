import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InMemoryCollectionRepository } from '../collection/InMemoryCollectionRepository';
import { InMemoryUserRepository } from './InMemoryUserRepository';
import { UserService, UserServiceError } from './UserService';
import { isCreator } from './domain/types';

describe('UserService', () => {
  const authUser = {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'alice@example.com',
    user_metadata: { preferred_username: 'alice', full_name: 'Alice' },
    app_metadata: { provider: 'email' },
  };

  function setup(totalReelLikesReceived = 0) {
    const users = new InMemoryUserRepository();
    const collections = new InMemoryCollectionRepository();
    const svc = new UserService(users, {
      hideCreatorCollectionsFromDiscovery: (id) => collections.hideCreatorFromDiscovery(id),
      restoreCreatorCollectionsDiscovery: (id) => collections.restoreCreatorDiscovery(id),
      sumPublishedCollectionSaves: (id) => collections.sumPublishedCollectionSaves(id),
      countPublishedPublicCollections: (id) => collections.countPublishedPublicCollections(id),
    }, {
      sumPublicReelLikesReceived: async () => totalReelLikesReceived,
    });
    return { users, collections, svc };
  }

  it('ensures user from auth with creator_status NONE', async () => {
    const { svc } = setup();
    const user = await svc.ensureFromAuth(authUser);
    assert.equal(user.id, authUser.id);
    assert.equal(user.username, 'alice');
    assert.equal(user.creatorStatus, 'NONE');
    assert.equal(user.accountStatus, 'ACTIVE');
    assert.equal(user.emailMirrored, 'alice@example.com');
    assert.equal(isCreator(user), false);

    const again = await svc.ensureFromAuth(authUser);
    assert.equal(again.id, user.id);
  });

  it('runs creator onboarding to ACTIVE', async () => {
    const { svc } = setup();
    await svc.ensureFromAuth(authUser);
    await svc.startCreatorOnboarding(authUser.id);
    const active = await svc.completeCreatorOnboarding(authUser.id);
    assert.equal(active.creatorStatus, 'ACTIVE');
    assert.equal(isCreator(active), true);
    await svc.assertCanCreateCollections(authUser.id);
  });

  it('blocks collection create when not ACTIVE creator', async () => {
    const { svc } = setup();
    await svc.ensureFromAuth(authUser);
    await assert.rejects(
      () => svc.assertCanCreateCollections(authUser.id),
      (e: unknown) => e instanceof UserServiceError && e.statusCode === 403,
    );
  });

  it('keeps account ACTIVE when creator is SUSPENDED', async () => {
    const { svc } = setup();
    await svc.ensureFromAuth(authUser);
    await svc.startCreatorOnboarding(authUser.id);
    await svc.completeCreatorOnboarding(authUser.id);
    const suspended = await svc.suspendCreator(authUser.id);
    assert.equal(suspended.creatorStatus, 'SUSPENDED');
    assert.equal(suspended.accountStatus, 'ACTIVE');
    await assert.rejects(() => svc.assertCanCreateCollections(authUser.id));
  });

  it('changes username and reserves old handle for redirect', async () => {
    const { svc } = setup();
    await svc.ensureFromAuth(authUser);
    await svc.changeUsername(authUser.id, 'alice2');
    const profile = await svc.getPublicProfile('alice2');
    assert.equal(profile?.username, 'alice2');
    const redirect = await svc.resolveUsernameRedirect('alice');
    assert.equal(redirect, 'alice2');
  });

  it('soft-deletes user and hides collection discovery', async () => {
    const { svc, collections } = setup();
    await svc.ensureFromAuth(authUser);
    await svc.startCreatorOnboarding(authUser.id);
    await svc.completeCreatorOnboarding(authUser.id);

    const col = await collections.insertCollection({
      slug: 'c1',
      creatorId: authUser.id,
      originType: 'url_ingest',
    });
    await collections.updateCollection(col.id, {
      status: 'published',
      visibility: 'public',
      feedEligible: true,
      searchEligible: true,
      recsEligible: true,
    });

    await svc.deleteAccount(authUser.id);
    const deleted = await svc.getById(authUser.id);
    assert.equal(deleted?.accountStatus, 'DELETED');
    assert.ok(deleted?.deletedAt);
    assert.equal(deleted?.emailMirrored, null);

    const after = await collections.getCollection(col.id);
    assert.equal(after?.feedEligible, false);
    assert.equal(after?.searchEligible, false);
    assert.equal(after?.creatorId, authUser.id);

    await svc.restoreAccount(authUser.id);
    const restoredCol = await collections.getCollection(col.id);
    assert.equal(restoredCol?.feedEligible, true);
  });

  it('updates profile and locale', async () => {
    const { svc } = setup();
    await svc.ensureFromAuth(authUser);
    await svc.updateProfile(authUser.id, { bio: 'Hello', websiteUrl: 'https://example.com' });
    await svc.updateLocale(authUser.id, { country: 'US', language: 'en', timezone: 'UTC' });
    const settings = await svc.getSettings(authUser.id);
    assert.equal(settings?.bio, 'Hello');
    assert.equal(settings?.country, 'US');
    assert.equal(settings?.isCreator, false);
    assert.equal(settings?.publicStats.totalReelLikesReceived, 0);
  });

  it('updates commerce country from location without fabricating codes', async () => {
    const { svc } = setup();
    await svc.ensureFromAuth(authUser);
    const inResult = await svc.updateCommerceCountry(authUser.id, {
      country: 'IN',
      source: 'location',
    });
    assert.equal(inResult.changed, true);
    assert.equal(inResult.user.country, 'IN');
    assert.equal(inResult.user.countrySource, 'location');
    assert.ok(inResult.user.countryDetectedAt);
    assert.ok(inResult.user.lastLocationCheckAt);

    const usResult = await svc.updateCommerceCountry(authUser.id, {
      country: 'US',
      source: 'location',
    });
    assert.equal(usResult.changed, true);
    assert.equal(usResult.user.country, 'US');

    const same = await svc.updateCommerceCountry(authUser.id, {
      country: 'US',
      source: 'location',
    });
    assert.equal(same.changed, false);
    assert.equal(same.user.country, 'US');
  });

  it('does not let location overwrite a manual commerce country unless forced', async () => {
    const { svc } = setup();
    await svc.ensureFromAuth(authUser);
    await svc.updateCommerceCountry(authUser.id, { country: 'GB', source: 'manual' });
    const blocked = await svc.updateCommerceCountry(authUser.id, {
      country: 'IN',
      source: 'location',
    });
    assert.equal(blocked.changed, false);
    assert.equal(blocked.user.country, 'GB');
    assert.equal(blocked.user.countrySource, 'manual');

    const forced = await svc.updateCommerceCountry(authUser.id, {
      country: 'IN',
      source: 'location',
      force: true,
    });
    assert.equal(forced.changed, true);
    assert.equal(forced.user.country, 'IN');
    assert.equal(forced.user.countrySource, 'location');
  });

  it('attaches total Reel likes received and live Collection count', async () => {
    const { svc, collections } = setup(14);
    await svc.ensureFromAuth(authUser);
    await svc.startCreatorOnboarding(authUser.id);
    await svc.completeCreatorOnboarding(authUser.id);

    const a = await collections.insertCollection({
      slug: 'saves-a',
      creatorId: authUser.id,
      originType: 'url_ingest',
    });
    await collections.updateCollection(a.id, {
      status: 'published',
      visibility: 'public',
      moderationState: 'clear',
      publishedAt: new Date().toISOString(),
      savesCount: 3,
    });
    const b = await collections.insertCollection({
      slug: 'saves-b',
      creatorId: authUser.id,
      originType: 'url_ingest',
    });
    await collections.updateCollection(b.id, {
      status: 'published',
      visibility: 'public',
      moderationState: 'clear',
      publishedAt: new Date().toISOString(),
      savesCount: 7,
    });
    const draft = await collections.insertCollection({
      slug: 'saves-draft',
      creatorId: authUser.id,
      originType: 'manual_curation',
    });
    await collections.updateCollection(draft.id, {
      status: 'draft',
      visibility: 'private',
      savesCount: 100,
    });

    const profile = await svc.getPublicProfile('alice');
    assert.equal(profile?.publicStats.totalReelLikesReceived, 14);
    assert.equal(profile?.publicStats.collectionCount, 2);
    assert.equal('savesCount' in (profile?.publicStats ?? {}), false);
    const settings = await svc.getSettings(authUser.id);
    assert.equal(settings?.publicStats.totalReelLikesReceived, 14);
    assert.equal(settings?.publicStats.collectionCount, 2);
    assert.equal('savesCount' in (settings?.publicStats ?? {}), false);
  });
});
