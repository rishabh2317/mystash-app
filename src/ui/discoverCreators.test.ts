import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { Video } from '@/src/mocks/videos';
import {
  buildDiscoverCreatorSeeds,
  DISCOVER_CREATORS_COPY,
  DISCOVER_CREATORS_PAGE_LIMIT,
  DISCOVER_CREATORS_PROFILE_LIMIT,
  discoverCreatorsPageSlice,
  discoverCreatorsProfileSlice,
} from './discoverCreators';

const ROOT = join(import.meta.dirname, '..', '..');

function video(partial: Partial<Video> & Pick<Video, 'id' | 'curator_id'>): Video {
  return {
    url: 'https://example.com/v',
    thumbnail: 'https://example.com/t.jpg',
    creator_name: 'Creator',
    stash_score: 1,
    product_name: 'Item',
    collection_id: `col-${partial.id}`,
    video_title: `Title ${partial.id}`,
    products: [],
    ...partial,
  };
}

describe('discover creators seeds', () => {
  it('dedupes by username, excludes self, and respects limit', () => {
    const seeds = buildDiscoverCreatorSeeds(
      [
        video({ id: '1', curator_id: '@alice', creator_name: 'Alice' }),
        video({ id: '2', curator_id: 'alice', creator_name: 'Alice again' }),
        video({ id: '3', curator_id: '@bob', creator_name: 'Bob' }),
        video({ id: '4', curator_id: '@me', creator_name: 'Me' }),
        video({
          id: '5',
          curator_id: '11111111-1111-1111-1111-111111111111',
          creator_name: 'UUID only',
        }),
      ],
      { excludeUsername: 'me', limit: 10 },
    );
    assert.deepEqual(
      seeds.map((s) => s.username),
      ['alice', 'bob'],
    );
  });

  it('caps profile and page slices', () => {
    assert.equal(DISCOVER_CREATORS_PROFILE_LIMIT, 6);
    assert.equal(DISCOVER_CREATORS_PAGE_LIMIT, 15);
    const many = Array.from({ length: 20 }, (_, i) => ({
      creator: { userId: String(i) } as never,
      previewUrls: [],
      followedByLabel: null,
    }));
    assert.equal(discoverCreatorsProfileSlice(many).length, 6);
    assert.equal(discoverCreatorsPageSlice(many).length, 15);
  });
});

describe('discover creators architecture', () => {
  it('wires Personal Profile section without touching public header or inventing APIs', () => {
    const personal = readFileSync(join(ROOT, 'components/profile/PersonalProfile.tsx'), 'utf8');
    const header = readFileSync(join(ROOT, 'components/profile/PersonalProfileHeader.tsx'), 'utf8');
    const publicHeader = readFileSync(
      join(ROOT, 'components/creator/CreatorProfileHeader.tsx'),
      'utf8',
    );
    const section = readFileSync(
      join(ROOT, 'components/profile/DiscoverCreatorsSection.tsx'),
      'utf8',
    );
    const card = readFileSync(
      join(ROOT, 'components/creator/DiscoverCreatorSuggestionCard.tsx'),
      'utf8',
    );
    const page = readFileSync(join(ROOT, 'app/profile/discover-creators.tsx'), 'utf8');
    const load = readFileSync(join(ROOT, 'src/services/discoverCreatorsLoad.ts'), 'utf8');

    assert.match(personal, /DiscoverCreatorsSection/);
    assert.match(personal, /ProfileContentTabs/);
    assert.doesNotMatch(header, /DiscoverCreators/);
    assert.doesNotMatch(publicHeader, /DiscoverCreators/);

    assert.match(section, /DISCOVER_CREATORS_COPY\.title/);
    assert.match(section, /See more|seeMore/);
    assert.match(section, /\/profile\/discover-creators/);
    assert.match(section, /variant="compact"/);

    assert.match(page, /showBack/);
    assert.match(page, /DISCOVER_CREATORS_PAGE_LIMIT/);
    assert.match(page, /variant="detail"/);
    assert.match(page, /creatorProfileHref/);

    assert.match(card, /useCreatorFollowHandler/);
    assert.match(card, /FollowControl/);
    assert.match(card, /followedByLabel/);
    assert.match(card, /previewUrls/);

    assert.match(load, /fetchVideos/);
    assert.match(load, /fetchPublicCreatorByUsername/);
    assert.match(load, /listCreatorCollections/);
    assert.match(load, /isFollowingCreator/);
    assert.doesNotMatch(load, /\/search\/candidates/);
    assert.equal(DISCOVER_CREATORS_COPY.title, "Discover Creators You'll Love");
  });
});
