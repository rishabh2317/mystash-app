import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { PRIVATE_USER_FIELDS } from './domain/types';
import { InMemoryCollectionRepository } from '../collection/InMemoryCollectionRepository';
import { InMemoryUserRepository } from './InMemoryUserRepository';
import { UserService } from './UserService';

const ROUTES = readFileSync(join(__dirname, 'routes.ts'), 'utf8');

describe('user HTTP routes authorization surface', () => {
  it('exposes self-service creator onboarding and not operator suspend/reinstate', () => {
    assert.match(ROUTES, /\/users\/me\/creator\/start/);
    assert.match(ROUTES, /\/users\/me\/creator\/complete/);
    assert.match(ROUTES, /\/users\/me\/creator\/abandon/);
    assert.match(ROUTES, /\/users\/me\/profile/);
    assert.match(ROUTES, /\/users\/by-username\//);
    assert.doesNotMatch(ROUTES, /suspendCreator/);
    assert.doesNotMatch(ROUTES, /reinstateCreator/);
    assert.doesNotMatch(ROUTES, /suspendAccount/);
    assert.doesNotMatch(ROUTES, /reinstateAccount/);
    assert.doesNotMatch(ROUTES, /\/users\/me\/creator\/suspend/);
    assert.match(ROUTES, /requireVerifiedEmail: true/);
  });

  it('returns only public fields from getPublicProfile', async () => {
    const users = new InMemoryUserRepository();
    const collections = new InMemoryCollectionRepository();
    const svc = new UserService(users, {
      hideCreatorCollectionsFromDiscovery: (id) => collections.hideCreatorFromDiscovery(id),
      restoreCreatorCollectionsDiscovery: (id) => collections.restoreCreatorDiscovery(id),
      sumPublishedCollectionSaves: (id) => collections.sumPublishedCollectionSaves(id),
      countPublishedPublicCollections: (id) => collections.countPublishedPublicCollections(id),
    });
    await svc.ensureFromAuth({
      id: '11111111-1111-1111-1111-111111111111',
      email: 'alice@example.com',
      user_metadata: { preferred_username: 'alice' },
    });
    const profile = await svc.getPublicProfile('alice');
    assert.ok(profile);
    for (const field of PRIVATE_USER_FIELDS) {
      assert.equal(Object.hasOwn(profile, field), false, field);
    }
  });
});
