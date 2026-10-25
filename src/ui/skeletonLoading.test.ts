import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

describe('skeleton loading contracts', () => {
  it('SkeletonBlock uses theme tokens and reduced motion', () => {
    const src = read('components/status/SkeletonBlock.tsx');
    assert.match(src, /tokens\.color\.surfaceSubtle/);
    assert.match(src, /usePrefersReducedMotion/);
    assert.match(src, /withRepeat/);
    assert.match(src, /if \(reduceMotion\)/);
    assert.match(src, /accessibilityElementsHidden/);
  });

  it('wired screens show skeletons instead of a full-content spinner on initial fetch', () => {
    const stash = read('app/(tabs)/stash.tsx');
    assert.match(stash, /StashHomeSkeleton/);
    assert.match(stash, /PlaceCardSkeleton/);
    assert.match(stash, /resolveListLoadState/);

    const product = read('app/product/[productId].tsx');
    assert.match(product, /ProductPageSkeleton/);
    assert.match(product, /retainLoadedContent/);
    assert.match(product, /hasDetailContent/);
    assert.doesNotMatch(product, /ActivityIndicator/);

    const collection = read('app/(tabs)/collection/[collectionId].tsx');
    assert.match(collection, /CollectionPageSkeleton/);
    assert.match(collection, /retainLoadedContent/);
    assert.doesNotMatch(collection, /ActivityIndicator/);

    const search = read('app/(tabs)/search.tsx');
    const activity = read('components/search/YourActivitySection.tsx');
    assert.match(search, /SearchDiscoverSkeleton/);
    assert.match(activity, /ShareActivityCardSkeleton/);
    assert.match(search, /SearchResultsSkeleton/);
    assert.match(search, /retainLoadedContent/);
    assert.doesNotMatch(search, /Searching…/);

    const creator = read('app/creator/[username].tsx');
    assert.match(creator, /ProfileHeaderSkeleton/);
    assert.match(creator, /retainLoadedContent/);

    const profile = read('app/(tabs)/profile.tsx');
    assert.match(profile, /ProfileHeaderSkeleton/);

    const notifications = read('app/notifications.tsx');
    assert.match(notifications, /NotificationRowSkeleton/);
    assert.doesNotMatch(notifications, /ActivityIndicator/);

    const shares = read('app/shares.tsx');
    assert.match(shares, /ShareActivityCardSkeleton/);
    assert.doesNotMatch(shares, /ActivityIndicator/);

    const discover = read('app/profile/discover-creators.tsx');
    assert.match(discover, /DiscoverCreatorSuggestionCardSkeleton/);
    assert.doesNotMatch(discover, /ActivityIndicator/);

    const followers = read('app/profile/followers.tsx');
    assert.match(followers, /TextBlockSkeleton/);
    assert.doesNotMatch(followers, /ActivityIndicator/);

    const following = read('app/profile/following.tsx');
    assert.match(following, /TextBlockSkeleton/);
    assert.doesNotMatch(following, /ActivityIndicator/);
  });

  it('clears stale payloads when the requested identity changes', () => {
    const product = read('app/product/[productId].tsx');
    assert.match(product, /if \(!keep\) \{/);
    assert.match(product, /setPage\(null\)/);

    const collection = read('app/(tabs)/collection/[collectionId].tsx');
    assert.match(collection, /if \(!keep\) \{/);
    assert.match(collection, /setDetail\(null\)/);

    const search = read('app/(tabs)/search.tsx');
    assert.match(search, /resourceIdentity\('search', query\)/);
    assert.match(search, /setSections\(EMPTY_SECTIONS\)/);

    const creator = read('app/creator/[username].tsx');
    assert.match(creator, /setCreator\(null\)/);
  });

  it('keeps error retry paths and does not leave skeletons after failure', () => {
    const product = read('app/product/[productId].tsx');
    assert.match(product, /loadState === 'error'/);
    assert.match(product, /PRODUCT_PAGE_COPY\.retry/);

    const stash = read('app/(tabs)/stash.tsx');
    assert.match(stash, /status === 'error'/);
    assert.match(stash, /BAG_COPY\.loadError/);

    const notifications = read('app/notifications.tsx');
    assert.match(notifications, /NOTIFICATIONS_COPY\.retry/);
    assert.match(notifications, /loadFirst\('loading'\)/);
  });
});
