import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ContentSourceService } from '../content-source/ContentSourceService';
import { InMemoryContentSourceRepository } from '../content-source/InMemoryContentSourceRepository';
import { applyLibraryPage } from './applyLibraryPage';
import { InMemoryCreatorLibraryRepository } from './InMemoryCreatorLibraryRepository';
import { librarySyncRejection, runBoundedLibrarySync } from './runBoundedLibrarySync';
import { mapPlaylistItem } from './youtubePlaylist';

function service() {
  const sources = new InMemoryContentSourceRepository();
  const content = new ContentSourceService(sources, { enqueue: async () => 'job' });
  const library = new InMemoryCreatorLibraryRepository(sources.sources);
  return { sources, content, library };
}

describe('YouTube playlist mapping', () => {
  it('maps metadata and treats private videos as unavailable', () => {
    const item = mapPlaylistItem({
      snippet: {
        title: 'Short',
        publishedAt: '2026-01-01T00:00:00Z',
        resourceId: { videoId: 'abcdefghijk' },
        thumbnails: { medium: { url: 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg' } },
      },
      status: { privacyStatus: 'private' },
    });
    assert.equal(item?.videoId, 'abcdefghijk');
    assert.equal(item?.availability, 'unavailable');
    assert.equal(item?.thumbnailUrl, 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg');
    assert.equal(mapPlaylistItem({ snippet: { title: 'missing' } }), null);
  });
});

describe('creator library sync', () => {
  it('upserts one content source per video and is idempotent', async () => {
    const { sources, content, library } = service();
    const item = {
      videoId: 'abcdefghijk',
      title: 'One',
      thumbnailUrl: 'https://img.test/a.jpg',
      publishedAt: '2026-01-01T00:00:00Z',
      availability: 'available' as const,
    };
    await applyLibraryPage({
      contentSources: content,
      library,
      userId: 'user-1',
      connectedAccountId: 'acct-1',
      items: [item],
      seenAt: '2026-02-01T00:00:00.000Z',
    });
    await applyLibraryPage({
      contentSources: content,
      library,
      userId: 'user-1',
      connectedAccountId: 'acct-1',
      items: [{ ...item, title: 'One updated' }],
      seenAt: '2026-02-02T00:00:00.000Z',
    });
    assert.equal(sources.sources.size, 1);
    assert.equal(library.memberships.size, 1);
    const source = [...sources.sources.values()][0]!;
    assert.equal(source.externalId, 'abcdefghijk');
    assert.equal(source.platform, 'youtube');
    assert.equal(source.title, 'One updated');
    assert.equal(source.processingStatus, 'RECEIVED');
    const listed = await library.listForUser('user-2', 10);
    assert.equal(listed.length, 0);
  });

  it('marks videos missing from a later sync unavailable without deleting identity', async () => {
    const { sources, content, library } = service();
    const run1 = '2026-02-01T00:00:00.000Z';
    await applyLibraryPage({
      contentSources: content,
      library,
      userId: 'user-1',
      connectedAccountId: 'acct-1',
      items: [
        { videoId: 'abcdefghijk', title: 'A', thumbnailUrl: null, publishedAt: null, availability: 'available' },
        { videoId: 'bbcdefghijk', title: 'B', thumbnailUrl: null, publishedAt: null, availability: 'available' },
      ],
      seenAt: run1,
    });
    const run2 = '2026-03-01T00:00:00.000Z';
    await applyLibraryPage({
      contentSources: content,
      library,
      userId: 'user-1',
      connectedAccountId: 'acct-1',
      items: [
        { videoId: 'abcdefghijk', title: 'A', thumbnailUrl: null, publishedAt: null, availability: 'available' },
      ],
      seenAt: run2,
    });
    const hidden = await library.markUnseenUnavailable('acct-1', run2);
    assert.equal(hidden, 1);
    assert.equal(sources.sources.size, 2);
    const items = await library.listForUser('user-1', 10);
    const missing = items.find((row) => row.externalId === 'bbcdefghijk');
    assert.equal(missing?.availability, 'unavailable');
  });

  it('paginates and continues after the page budget', async () => {
    const seen: string[] = [];
    let continued = false;
    let completed = false;
    const outcome = await runBoundedLibrarySync({
      runStartedAt: '2026-03-01T00:00:00.000Z',
      pageToken: null,
      uploadsPlaylistId: null,
      pagesPerJob: 2,
      fetchPage: async ({ pageToken }) => {
        if (!pageToken) {
          return {
            uploadsPlaylistId: 'UU1',
            items: [
              { videoId: 'abcdefghijk', title: 'p1', thumbnailUrl: null, publishedAt: null, availability: 'available' },
            ],
            nextPageToken: 'page-2',
          };
        }
        return {
          uploadsPlaylistId: 'UU1',
          items: [
            { videoId: 'bbcdefghijk', title: 'p2', thumbnailUrl: null, publishedAt: null, availability: 'available' },
          ],
          nextPageToken: 'page-3',
        };
      },
      applyItems: async (items) => {
        seen.push(...items.map((item) => item.videoId));
      },
      onComplete: async () => {
        completed = true;
      },
      onContinue: async (next) => {
        continued = next.pageToken === 'page-3' && next.uploadsPlaylistId === 'UU1';
      },
    });
    assert.equal(outcome, 'continued');
    assert.deepEqual(seen, ['abcdefghijk', 'bbcdefghijk']);
    assert.equal(continued, true);
    assert.equal(completed, false);
  });

  it('does not mark the library complete when a page fetch fails', async () => {
    let completed = false;
    await assert.rejects(
      () =>
        runBoundedLibrarySync({
          runStartedAt: '2026-03-01T00:00:00.000Z',
          pageToken: null,
          uploadsPlaylistId: 'UU1',
          pagesPerJob: 2,
          fetchPage: async () => {
            throw new Error('quota');
          },
          applyItems: async () => undefined,
          onComplete: async () => {
            completed = true;
          },
          onContinue: async () => undefined,
        }),
      /quota/,
    );
    assert.equal(completed, false);
  });

  it('rejects Instagram and disabled YouTube', () => {
    assert.equal(librarySyncRejection({ provider: 'instagram', youtubeEnabled: true })?.statusCode, 403);
    assert.equal(librarySyncRejection({ provider: 'youtube', youtubeEnabled: false })?.statusCode, 403);
    assert.equal(librarySyncRejection({ provider: 'youtube', youtubeEnabled: true }), null);
  });
});
