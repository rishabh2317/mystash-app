import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { optimisticReelLike } from '@/src/ui/reelLikes';

const ROOT = join(import.meta.dirname, '..', '..');

describe('Reel Like optimistic state', () => {
  it('increments on Like and decrements on Unlike without going below zero', () => {
    assert.deepEqual(optimisticReelLike({ liked: false, likeCount: 0 }), {
      liked: true,
      likeCount: 1,
    });
    assert.deepEqual(optimisticReelLike({ liked: true, likeCount: 4 }), {
      liked: false,
      likeCount: 3,
    });
    assert.deepEqual(optimisticReelLike({ liked: true, likeCount: 0 }), {
      liked: false,
      likeCount: 0,
    });
  });

  it('wires Like independently from Collection Save in the Home action stack', () => {
    const home = readFileSync(join(ROOT, 'app/(tabs)/index.tsx'), 'utf8');
    const stack = readFileSync(join(ROOT, 'components/feed/ReelActionStack.tsx'), 'utf8');
    const hook = readFileSync(join(ROOT, 'src/services/reelLikeEngagement.ts'), 'utf8');

    assert.match(home, /like=\{/);
    assert.match(stack, /LikeControl/);
    assert.match(stack, /SaveControl/);
    assert.match(hook, /video\?\.id/);
    assert.doesNotMatch(hook, /collection_id/);
    assert.match(hook, /pendingRef\.current/);
    assert.match(hook, /requestId\.current !== id/);
  });
});
