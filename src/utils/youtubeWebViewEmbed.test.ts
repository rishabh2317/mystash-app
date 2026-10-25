import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'youtubeWebViewEmbed.ts'), 'utf8');
const reelItem = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../components/YouTubeReelItem.tsx'),
  'utf8',
);

describe('youtube feed embed', () => {
  it('reports the first playing frame and recrops without a new iframe src', () => {
    assert.match(src, /postMessage\('firstFrame'\)/);
    assert.match(src, /postMessage\('iframeLoaded'\)/);
    assert.match(src, /event:'listening'/);
    assert.match(src, /function youtubeCropScript/);
    assert.match(src, /iframe\.style\.transform=/);
    assert.doesNotMatch(src.slice(src.indexOf('function youtubeCropScript')), /iframe\.src/);

    const idPattern = src.match(
      /\/\(\?:embed\\\/\|\\\/shorts\\\/\|\\\/v\\\/\|youtu\\\.be\\\/\|v=\)\(\[a-zA-Z0-9_-]\{11\}\)\/(?![gimsuy])/,
    );
    assert.ok(idPattern);
    const extractId = new Function('url', `return url.match(${idPattern[0]})?.[1] ?? null`) as (
      url: string,
    ) => string | null;
    assert.equal(extractId('https://www.youtube.com/watch?v=abcdefghijk'), 'abcdefghijk');
    assert.equal(extractId('https://www.youtube.com/shorts/abcdefghijk'), 'abcdefghijk');
    assert.equal(extractId('https://www.youtube.com/embed/abcdefghijk'), 'abcdefghijk');
  });

  it('reveals the Watch poster on iframe load and only logs firstFrame', () => {
    const revealAt = reelItem.indexOf('shouldRevealYoutubePoster(message)');
    const frameAt = reelItem.indexOf('shouldRevealFeedFrame(message)');
    assert.ok(revealAt > 0);
    assert.ok(frameAt > revealAt);
    assert.match(reelItem.slice(revealAt, frameAt), /setRevealedId\(videoId\)/);
    assert.doesNotMatch(reelItem.slice(frameAt, frameAt + 280), /setRevealedId/);
  });
});
