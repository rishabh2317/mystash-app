import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { placeSourcePreview } from './placeSourceVideo';
import { hydratePlaceStashItem, unifiedPlaceStashItems } from './stashPlaces';

const youtube = { url: 'https://youtu.be/dQw4w9WgXcQ?t=3', thumbnailUrl: 'https://fixture.invalid/source.jpg' };
const destination = { kind: 'google_search', query: 'Cafe', url: 'https://www.google.com/search?q=Cafe' };

it('reuses existing YouTube embed conversion while retaining the actual source URL and poster', () => {
  const video = placeSourcePreview(youtube);
  assert.equal(video?.url, youtube.url);
  assert.equal(video?.thumbnail, youtube.thumbnailUrl);
  assert.match(video!.embed_url!, /^https:\/\/www.youtube.com\/embed\/dQw4w9WgXcQ\?/);
  assert.equal(video?.id, 'source:youtube:dQw4w9WgXcQ');
});

it('uses existing Instagram embedding without manufacturing video URLs from place or thumbnail IDs', () => {
  const source = { url: 'https://www.instagram.com/reel/ABC_123/', thumbnailUrl: null };
  const video = placeSourcePreview(source);
  assert.equal(video?.url, source.url);
  assert.match(video!.embed_url!, /^https:\/\/www.instagram.com\/p\/ABC_123\/embed/);
  assert.equal(video?.thumbnail, '');
});

it('rejects unavailable, malformed, unsafe and unsupported source URLs', () => {
  assert.equal(placeSourcePreview(null), null);
  for (const url of ['javascript:alert(1)', 'http://youtube.com/shorts/dQw4w9WgXcQ',
    'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ', 'https://evil.test/youtube.com/watch?v=dQw4w9WgXcQ',
    'https://user:password@youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com:8443/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=invalid', 'https://instagram.com/', 'not-a-url']) {
    assert.equal(placeSourcePreview({ url, thumbnailUrl: null }), null, url);
  }
});

it('preserves source metadata through hydration/promotion while leaving legacy payloads supported', () => {
  const lead = hydratePlaceStashItem({ kind: 'unresolved', leadId: 'save', saveId: 'save', name: 'Cafe', destination, sourceVideo: youtube })!;
  const resolved = hydratePlaceStashItem({ kind: 'resolved', placeId: 'place', saveId: 'save', name: 'Cafe', destination })!;
  const result = unifiedPlaceStashItems([lead, resolved]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].sourceVideo, youtube);
  assert.equal(result[0].kind, 'resolved');
  assert.equal(resolved.sourceVideo, undefined);
  assert.equal(hydratePlaceStashItem({ kind: 'unresolved', leadId: 'other', name: 'Cafe', destination, sourceVideo: null })?.sourceVideo, null);
});

it('has Close/Android Back, bounded unavailable feedback, and unmounts embeds when dismissed', () => {
  const modal = readFileSync('components/place/PlaceSourceVideoModal.tsx', 'utf8');
  const list = readFileSync('components/place/StashPlacesContent.tsx', 'utf8');
  assert.match(modal, /onRequestClose=\{onClose\}/);
  assert.match(modal, /PLACE_SOURCE_COPY\.close/);
  assert.match(modal, /20_000/);
  assert.match(modal, /YouTubeReelItem/);
  assert.match(modal, /InstagramReelItem/);
  assert.match(list, /selectedSource \? <PlaceSourceVideoModal/);
  assert.match(list, /onClose=\{\(\) => setSelectedSources\(null\)\}/);
  assert.doesNotMatch(modal, /WebView|enqueueObservation|watch.duration|playback.position/);
});

it('recovers source actions for legacy payloads using exact persisted import and source identities', async () => {
  const { withPlaceSourceVideos } = await import('./placeSourceVideo');
  const lead = hydratePlaceStashItem({ kind: 'unresolved', leadId: 'legacy', name: 'Cafe', destination,
    source: { contentSourceId: 'content', userImportId: 'import' } })!;
  const shares = [{ importId: 'import', contentSourceId: 'content', sourceUrl: youtube.url }];
  assert.equal(withPlaceSourceVideos([lead], shares)[0].sourceVideo?.url, youtube.url);
  assert.equal(lead.sourceVideo, undefined, 'original data is preserved');
  assert.equal(withPlaceSourceVideos([lead], [{ ...shares[0], importId: 'other' }])[0].sourceVideo, undefined);
  assert.equal(withPlaceSourceVideos([lead], [{ ...shares[0], contentSourceId: 'other' }])[0].sourceVideo, undefined);
  assert.equal(withPlaceSourceVideos([lead], [])[0].sourceVideo, undefined);
  assert.equal(withPlaceSourceVideos([{ ...lead, sourceVideo: null }], shares)[0].sourceVideo, null);
  assert.equal(withPlaceSourceVideos([lead], [{ ...shares[0], sourceUrl: 'https://evil.invalid/reel' }])[0].sourceVideo, undefined);
  assert.deepEqual(withPlaceSourceVideos([{ ...lead, sourceVideo: youtube }], []), [{ ...lead, sourceVideo: youtube }]);
});
it('can recover a source from additional provenance after a promotion', async () => {
  const { withPlaceSourceVideos } = await import('./placeSourceVideo');
  const place = hydratePlaceStashItem({ kind: 'resolved', placeId: 'place', saveId: 'save', name: 'Cafe', destination,
    sources: [{ contentSourceId: 'second', userImportId: 'import', contentSourcePlaceId: 'hypothesis', addedAt: '2026-10-30' }] })!;
  assert.equal(withPlaceSourceVideos([place], [{ importId: 'import', contentSourceId: 'second', sourceUrl: youtube.url }])[0].sourceVideo?.url, youtube.url);
});
