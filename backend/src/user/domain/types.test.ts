import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PRIVATE_USER_FIELDS,
  PUBLIC_USER_PROFILE_FIELDS,
  toPublicProfile,
  type User,
} from './types';

function sampleUser(): User {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    authProvider: 'google',
    username: 'alice',
    displayName: 'Alice',
    profilePhotoUrl: null,
    bio: 'hi',
    websiteUrl: null,
    socialLinks: {},
    accountStatus: 'ACTIVE',
    creatorStatus: 'NONE',
    accountType: 'personal',
    country: 'IN',
    language: 'en',
    timezone: 'UTC',
    countryDetectedAt: null,
    lastLocationCheckAt: null,
    countrySource: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    emailMirrored: 'alice@example.com',
    followersCount: 1,
    followingCount: 2,
    collectionCount: 3,
    countersUpdatedAt: null,
    schemaVersion: 1,
    extensions: {},
  };
}

describe('public user profile fields', () => {
  it('omits email and internal account metadata', () => {
    const profile = toPublicProfile(sampleUser());
    assert.deepEqual(Object.keys(profile).sort(), [...PUBLIC_USER_PROFILE_FIELDS].sort());
    for (const field of PRIVATE_USER_FIELDS) {
      assert.equal(Object.hasOwn(profile, field), false);
    }
    assert.equal('emailMirrored' in profile, false);
    assert.equal('accountStatus' in profile, false);
    assert.equal('authProvider' in profile, false);
  });
});
