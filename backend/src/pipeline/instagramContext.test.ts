import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyInstagramProbeError,
  gatherInstagramContext,
} from './instagramContext';

describe('classifyInstagramProbeError', () => {
  it('classifies login/private as restricted', () => {
    const r = classifyInstagramProbeError('ERROR: login required to access this content');
    assert.equal(r.availability, 'restricted');
    assert.equal(r.code, 'SOURCE_RESTRICTED');
  });

  it('classifies 404 as unavailable', () => {
    const r = classifyInstagramProbeError('ERROR: 404 Not Found');
    assert.equal(r.availability, 'unavailable');
    assert.equal(r.code, 'SOURCE_UNAVAILABLE');
  });
});

describe('gatherInstagramContext', () => {
  it('returns available when oembed succeeds', async () => {
    const pack = await gatherInstagramContext('https://www.instagram.com/reel/AbC123xyz/', {
      fetchImpl: (async () =>
        new Response(JSON.stringify({ title: 'Summer linen', author_name: 'alice', thumbnail_url: 'https://img/t.jpg' }), {
          status: 200,
        })) as typeof fetch,
    });
    assert.equal(pack.availability, 'available');
    assert.equal(pack.title, 'Summer linen');
    assert.equal(pack.authorName, 'alice');
    assert.ok(pack.sources.includes('oembed'));
  });

  it('fails restricted when probe requires login and oembed is empty', async () => {
    const pack = await gatherInstagramContext('https://www.instagram.com/reel/AbC123xyz/', {
      fetchImpl: (async () => new Response('', { status: 404 })) as typeof fetch,
      probe: async () => ({ ok: false, stderr: 'login required', code: 1 }),
    });
    assert.equal(pack.availability, 'restricted');
    assert.equal(pack.errorCode, 'SOURCE_RESTRICTED');
    assert.equal(pack.title, '');
  });

  it('rejects non-reel Instagram URLs', async () => {
    const pack = await gatherInstagramContext('https://www.instagram.com/nike/');
    assert.equal(pack.availability, 'unavailable');
    assert.equal(pack.errorCode, 'UNSUPPORTED_SOURCE');
  });

  it('uses yt-dlp json when oembed is empty', async () => {
    const pack = await gatherInstagramContext('https://www.instagram.com/reel/AbC123xyz/', {
      fetchImpl: (async () => new Response('', { status: 404 })) as typeof fetch,
      probe: async () => ({
        ok: true,
        json: {
          title: 'From dump',
          uploader: 'bob',
          description: 'caption with product',
          thumbnail: 'https://img/b.jpg',
        },
      }),
    });
    assert.equal(pack.availability, 'available');
    assert.equal(pack.title, 'From dump');
    assert.equal(pack.description, 'caption with product');
    assert.ok(pack.sources.includes('yt-dlp-json'));
  });
});
