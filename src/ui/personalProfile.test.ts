import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  PERSONAL_HAS_RECENTLY_VIEWED,
  PERSONAL_HAS_SAVED_PRODUCTS,
  PERSONAL_PROFILE_TABS,
  PERSONAL_RAIL_PREVIEW,
  personalProductCountLabel,
  personalRailPreview,
  personalStats,
  PROFILE_VIDEO_GRID_ASPECT,
  PROFILE_VIDEO_GRID_COLUMNS,
  PROFILE_VIDEO_GRID_GAP,
  PROFILE_VIDEO_GRID_GUTTER,
  profileGridCellWidth,
  shouldShowPersonalViewAll,
} from './personalProfile';

const ROOT = process.cwd();

describe('personal profile architecture', () => {
  it('keeps the You tab off the public CreatorProfile storefront', () => {
    const personal = readFileSync(join(ROOT, 'app/(tabs)/profile.tsx'), 'utf8');
    const pub = readFileSync(join(ROOT, 'app/creator/[username].tsx'), 'utf8');
    assert.match(personal, /PersonalProfile/);
    assert.doesNotMatch(personal, /from '@\/components\/creator\/CreatorProfile'/);
    assert.match(pub, /from '@\/components\/creator\/CreatorProfile'/);
    assert.match(pub, /isSelf=\{isSelf\}/);
  });

  it('does not invent recently-viewed or saved-product rails', () => {
    assert.equal(PERSONAL_HAS_RECENTLY_VIEWED, false);
    assert.equal(PERSONAL_HAS_SAVED_PRODUCTS, false);
    const landing = readFileSync(join(ROOT, 'components/profile/PersonalProfile.tsx'), 'utf8');
    assert.doesNotMatch(landing, /Recently viewed/);
    assert.doesNotMatch(landing, /Saved products/i);
    assert.doesNotMatch(landing, /PERSONAL_PROFILE_COPY\.reels/);
    assert.match(landing, /PERSONAL_PROFILE_COPY\.emptySaved/);
    assert.match(landing, /ProfileContentTabs/);
    assert.match(landing, /PublicCollectionTile/);
    assert.match(landing, /DiscoverCreatorsSection/);
    assert.match(landing, /useDiscoverCreators/);
    assert.doesNotMatch(landing, /loadDiscoverCreatorSuggestions/);
  });

  it('View as others still opens the public creator route from Settings', () => {
    const settings = readFileSync(join(ROOT, 'app/settings/index.tsx'), 'utf8');
    assert.match(settings, /SETTINGS_COPY\.publicProfileValue/);
    assert.match(settings, /router\.push\(`\/creator\/\$\{encodeURIComponent\(profileHandle\)\}`\)/);
  });
});

describe('personal profile content', () => {
  it('previews a limited rail and always offers View all', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    assert.deepEqual(personalRailPreview(items), items.slice(0, PERSONAL_RAIL_PREVIEW));
    assert.equal(shouldShowPersonalViewAll(0), true);
    assert.equal(shouldShowPersonalViewAll(3), true);
  });

  it('builds compact stats from real counts only', () => {
    const stats = personalStats({
      collectionCount: 23,
      totalReelLikesReceived: 91,
      followingCount: 12,
      followersCount: 8200,
    });
    assert.deepEqual(
      stats.map((s) => s.id),
      ['collections', 'likes', 'following', 'followers'],
    );
    assert.equal(stats[1]?.value, 91);
    assert.equal(personalProductCountLabel(1), '1 product');
    assert.equal(personalProductCountLabel(12), '12 products');
    assert.deepEqual(
      PERSONAL_PROFILE_TABS.map((tab) => tab.id),
      ['collections', 'saved'],
    );
  });

  it('keeps Saved Collections separate from received Reel Likes', () => {
    const collectionApi = readFileSync(join(ROOT, 'src/services/collectionApi.ts'), 'utf8');
    assert.match(collectionApi, /Authorization/);
    assert.match(collectionApi, /fetchCollectionById/);
    const landing = readFileSync(join(ROOT, 'components/profile/PersonalProfile.tsx'), 'utf8');
    const header = readFileSync(join(ROOT, 'components/profile/PersonalProfileHeader.tsx'), 'utf8');
    assert.match(header, /publicCreatorStats/);
    assert.match(header, /ActionButton/);
    assert.match(header, /size="compact"/);
    assert.match(header, /radius="md"/);
    assert.match(header, /variant="outlinePrimary"/);
    assert.match(header, /variant="secondary"/);
    assert.match(header, /PERSONAL_PROFILE_COPY\.editProfile/);
    assert.match(header, /label="Share"/);
    assert.match(header, /onSharePress/);
    assert.doesNotMatch(header, /tokens\.color\.primary/);
    assert.doesNotMatch(header, /FollowControl/);
    assert.match(landing, /activeTab === 'collections' \? collections : saved/);
    assert.doesNotMatch(landing, /PersonalStatsBar/);
    assert.doesNotMatch(landing, /savedCount:/);
    assert.match(landing, /profileGridCellWidth/);
    assert.match(landing, /PROFILE_VIDEO_GRID_COLUMNS/);
    assert.match(landing, /PROFILE_VIDEO_GRID_ASPECT/);
    assert.match(landing, /PROFILE_VIDEO_GRID_GAP/);
    assert.match(landing, /flush/);
    assert.doesNotMatch(landing, /numColumns=\{2\}/);
    const list = readFileSync(join(ROOT, 'components/profile/PersonalCollectionList.tsx'), 'utf8');
    assert.match(list, /profileGridCellWidth/);
    assert.match(list, /PROFILE_VIDEO_GRID_COLUMNS/);
    assert.equal(PROFILE_VIDEO_GRID_COLUMNS, 3);
    assert.equal(PROFILE_VIDEO_GRID_ASPECT, 3 / 4);
    assert.equal(PROFILE_VIDEO_GRID_GAP, 1);
    assert.equal(PROFILE_VIDEO_GRID_GUTTER, 0);
    assert.equal(profileGridCellWidth(390, 16, 8), Math.floor((390 - 32 - 8) / 2));
    assert.equal(
      profileGridCellWidth(390, PROFILE_VIDEO_GRID_GUTTER, PROFILE_VIDEO_GRID_GAP, 3),
      Math.floor((390 - 2) / 3),
    );
  });
});
