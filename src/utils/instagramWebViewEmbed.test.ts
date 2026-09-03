import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildInstagramEmbedHtml, resolveInstagramPermalink } from './instagramWebViewEmbed';

describe('instagramWebViewEmbed', () => {
  it('uses /reel permalink for reel ingest URLs', () => {
    assert.equal(
      resolveInstagramPermalink('https://www.instagram.com/reel/AbC123xyz/embed/?captioned=0'),
      'https://www.instagram.com/reel/AbC123xyz/',
    );
  });

  it('uses /p permalink for post ingest URLs', () => {
    assert.equal(
      resolveInstagramPermalink('https://www.instagram.com/p/AbC123xyz/embed/?captioned=0'),
      'https://www.instagram.com/p/AbC123xyz/',
    );
  });

  it('kicks muted autoplay instead of leaving the Watch on Instagram poster', () => {
    const html = buildInstagramEmbedHtml('https://www.instagram.com/reel/AbC123xyz/');
    assert.match(html, /__mystashKickPlayback/);
    assert.match(html, /watch on instagram/i);
    assert.match(html, /data-instgrm-permalink="https:\/\/www.instagram.com\/reel\/AbC123xyz\/"/);
    assert.match(html, /mystashApplyCover/);
    assert.match(html, /max-width: none/);
  });
});
