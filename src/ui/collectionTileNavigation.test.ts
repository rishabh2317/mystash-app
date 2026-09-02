import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  collectionReelPath,
  collectionTilePressPath,
} from './collectionLayout';

const ROOT = join(import.meta.dirname, '..', '..');

function readRepoFile(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

describe('collection tile navigation', () => {
  it('routes collection tiles to the focused reel host', () => {
    assert.equal(collectionTilePressPath('col-abc'), '/reel/col-abc');
    assert.equal(collectionTilePressPath('col-abc'), collectionReelPath('col-abc'));
  });

  it('tile consumers navigate to reel, not the collection page', () => {
    const tileConsumers = [
      'app/(tabs)/profile.tsx',
      'app/creator/[username].tsx',
    ];
    for (const file of tileConsumers) {
      const src = readRepoFile(file);
      assert.match(src, /collectionTilePressPath\(/, `${file} must use collectionTilePressPath`);
      const handler = src.match(/const onPressCollection = useCallback\([\s\S]*?\[router\],\s*\);/)?.[0];
      assert.ok(handler, `${file} must define a collection tile press handler`);
      assert.doesNotMatch(
        handler,
        /router\.push\(`\/collection\/\$\{/,
        `${file} collection tile handler must not open /collection`,
      );
      assert.match(
        handler,
        /collectionTilePressPath\(/,
        `${file} collection tile handler must use collectionTilePressPath`,
      );
    }
  });

  it('typed search collection tiles open the search-scoped reel feed', () => {
    const search = readRepoFile('app/(tabs)/search.tsx');
    assert.match(search, /const onCollectionPress = useCallback/);
    assert.match(search, /shouldOpenSearchReelFeed/);
    assert.match(search, /beginSearchReelSession/);
    assert.match(search, /searchReelPath\(/);
    assert.match(search, /collectionTilePressPath\(/, 'explore landing keeps focused reel fallback');
  });

  it('focused reel View Collection still opens the collection page', () => {
    const dock = readRepoFile('components/BottomDock.tsx');
    assert.match(dock, /handleViewCollection[\s\S]*?router\.push\(`\/collection\/\$\{/);
  });

  it('search autocomplete uses search reel when typed results are available', () => {
    const search = readRepoFile('app/(tabs)/search.tsx');
    assert.match(search, /onSuggestionPress[\s\S]*?shouldOpenSearchReelFeed[\s\S]*?searchReelPath/);
  });
});
