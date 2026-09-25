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
  it('formats Posts / Followers / Following from real creator counts', () => {
    assert.equal(
      publicCreatorMetaLine({
        collectionCount: 1,
        followersCount: 1,
        followingCount: 1,
      }),
      '1 Posts · 1 Followers · 1 Following',
    );
    assert.equal(
      publicCreatorMetaLine({
        collectionCount: 12,
        followersCount: 8200,
        followingCount: 340,
      }),
      '12 Posts · 8.2K Followers · 340 Following',
    );
    assert.deepEqual(
      publicCreatorStats({
        collectionCount: 12,
        followersCount: 8200,
        followingCount: 340,
      }).map((item) => item.id),
      ['posts', 'followers', 'following'],
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
    const identity = readFileSync(join(ROOT, 'components/profile/ProfileIdentityHeader.tsx'), 'utf8');
    const route = readFileSync(join(ROOT, 'app/creator/[username].tsx'), 'utf8');
    const tile = readFileSync(join(ROOT, 'components/collection/CollectionTile.tsx'), 'utf8');
    const publicTile = readFileSync(join(ROOT, 'components/collection/PublicCollectionTile.tsx'), 'utf8');
    const card = readFileSync(join(ROOT, 'components/commerce/ProductCard.tsx'), 'utf8');

    assert.match(profile, /PublicCollectionTile/);
    assert.match(profile, /variant="related"/);
    assert.doesNotMatch(profile, /variant="publicProfile"/);
    assert.match(tile, /'public'/);
    assert.match(tile, /productLabel/);
    assert.match(tile, /bookmark/);
    assert.match(publicTile, /useCollectionSaveHandler/);
    assert.match(publicTile, /isCollectionSaved/);
    assert.match(card, /'related'/);

    assert.match(header, /ProfileIdentityHeader/);
    assert.match(header, /ProfileStatsStrip/);
    assert.match(header, /ProfileContentTabs/);
    assert.match(header, /FollowControl/);
    assert.match(header, /emphasis="brand"/);
    assert.match(header, /fullWidth/);
    assert.match(header, /Share/);
    assert.match(header, /onSharePress/);
    assert.match(header, /showHandle=\{false\}/);
    assert.match(header, /statsSlot/);
    assert.match(header, /publicCreatorStats/);
    assert.match(header, /followingCount/);
    assert.doesNotMatch(header, /totalReelLikesReceived/);
    assert.doesNotMatch(header, /savesCount/);
    assert.doesNotMatch(header, /MetaBar/);
    assert.doesNotMatch(header, /size="compact"/);

    assert.match(identity, /showHandle/);
    assert.match(identity, /statsSlot/);
    assert.match(identity, /typeStyle/);

    assert.match(route, /shareCreatorProfile/);
    assert.match(route, /onSharePress/);
    assert.match(route, /OverflowMenu/);
    assert.match(route, /Report/);
    assert.match(route, /Block/);
    assert.doesNotMatch(route, /ContextActions/);
    assert.match(route, /onFollowPress/);
    assert.match(route, /onAddToCart/);
    assert.match(route, /productPagePath/);
    assert.doesNotMatch(route, /ProductDetailsSheet/);
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
