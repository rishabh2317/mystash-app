import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  publicCollectionProductLabel,
  publicCreatorMetaLine,
  publicCreatorStats,
  reconcilePublicCollectionCount,
} from './publicCreatorProfile';

const ROOT = join(import.meta.dirname, '..', '..');

describe('public creator profile copy', () => {
  it('formats real Collection and received Reel Like counts', () => {
    assert.equal(
      publicCreatorMetaLine({
        collectionCount: 1,
        followersCount: 1,
        totalReelLikesReceived: 1,
      }),
      '1 Collections · 1 Followers · 1 Likes',
    );
    assert.equal(
      publicCreatorMetaLine({
        collectionCount: 12,
        followersCount: 8200,
        totalReelLikesReceived: 340,
      }),
      '12 Collections · 8.2K Followers · 340 Likes',
    );
    assert.deepEqual(
      publicCreatorStats({
        collectionCount: 12,
        followersCount: 8200,
        totalReelLikesReceived: 340,
      }).map((item) => item.id),
      ['collections', 'followers', 'likes'],
    );
    assert.equal(publicCollectionProductLabel(1), '1 product');
    assert.equal(publicCollectionProductLabel(8), '8 products');
    assert.equal(reconcilePublicCollectionCount(0, 3), 3);
    assert.equal(reconcilePublicCollectionCount(12, 3), 12);
  });
});

describe('public creator profile architecture', () => {
  it('uses shared identity/stats chrome and keeps personal-only surfaces off the storefront', () => {
    const profile = readFileSync(join(ROOT, 'components/creator/CreatorProfile.tsx'), 'utf8');
    const header = readFileSync(join(ROOT, 'components/creator/CreatorProfileHeader.tsx'), 'utf8');
    const route = readFileSync(join(ROOT, 'app/creator/[username].tsx'), 'utf8');
    const tile = readFileSync(join(ROOT, 'components/collection/CollectionTile.tsx'), 'utf8');
    const card = readFileSync(join(ROOT, 'components/commerce/ProductCard.tsx'), 'utf8');

    assert.match(profile, /variant="public"/);
    assert.match(profile, /variant="publicProfile"/);
    assert.match(tile, /'public'/);
    assert.match(card, /'publicProfile'/);

    assert.match(header, /ProfileIdentityHeader/);
    assert.match(header, /ProfileStatsStrip/);
    assert.match(header, /ProfileContentTabs/);
    assert.match(header, /FollowControl/);
    assert.match(header, /size="compact"/);
    assert.doesNotMatch(header, /emphasis="brand"/);
    assert.match(header, /publicCreatorStats/);
    assert.match(header, /totalReelLikesReceived/);
    assert.doesNotMatch(header, /savesCount/);
    assert.doesNotMatch(header, /followingCount/);
    assert.doesNotMatch(header, /MetaBar/);

    assert.match(route, /shareCreatorProfile/);
    assert.match(route, /onFollowPress/);
    assert.match(route, /ProductDetailsSheet/);
    assert.match(route, /collectionTilePressPath/);
    assert.match(route, /reconcilePublicCollectionCount/);

    for (const src of [profile, header, route]) {
      assert.doesNotMatch(src, /Saved collections/);
      assert.doesNotMatch(src, /Recently viewed/);
      assert.doesNotMatch(src, /Edit profile/);
      assert.doesNotMatch(src, /PersonalStatsBar/);
    }
  });
});
