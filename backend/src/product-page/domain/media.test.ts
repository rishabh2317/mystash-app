import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  dedupeRelatedMedia,
  excludeOriginalMedia,
  finalizeRelatedMedia,
  isUsableMediaUrl,
  mediaIdentityKey,
} from './media';
import type { ProductPageRelatedMedia } from './types';

function media(
  partial: Partial<ProductPageRelatedMedia> & Pick<ProductPageRelatedMedia, 'id' | 'url'>,
): ProductPageRelatedMedia {
  return {
    kind: 'short',
    label: 'YouTube Short',
    title: null,
    thumbnailUrl: null,
    collectionId: null,
    creator: null,
    views: 0,
    saves: 0,
    ...partial,
  };
}

describe('product page media identity', () => {
  it('treats equivalent YouTube URLs as one identity', () => {
    assert.equal(
      mediaIdentityKey('https://www.youtube.com/shorts/dQw4w9WgXcQ'),
      mediaIdentityKey('https://youtu.be/dQw4w9WgXcQ'),
    );
  });

  it('drops invalid media and duplicate identities', () => {
    const rows = dedupeRelatedMedia([
      media({ id: 'bad', url: 'javascript:alert(1)' }),
      media({ id: 'a', url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ' }),
      media({ id: 'b', url: 'https://youtu.be/dQw4w9WgXcQ' }),
      media({ id: 'c', url: 'https://www.instagram.com/reel/OTHER/' }),
    ]);
    assert.deepEqual(
      rows.map((row) => row.id),
      ['a', 'c'],
    );
    assert.equal(isUsableMediaUrl('file:///tmp/x'), false);
  });

  it('keeps the original source out of related media', () => {
    const related = finalizeRelatedMedia(
      [
        media({ id: 'orig-row', url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ' }),
        media({ id: 'other', url: 'https://www.instagram.com/reel/OTHER/' }),
      ],
      {
        contentSourceId: 'cs-orig',
        userImportId: null,
        kind: 'short',
        label: 'Found from this Short',
        url: 'https://youtu.be/dQw4w9WgXcQ',
        title: null,
        collectionId: null,
      },
      6,
    );
    assert.deepEqual(
      related.map((row) => row.id),
      ['other'],
    );
    assert.deepEqual(
      excludeOriginalMedia(
        [media({ id: 'cs-orig', url: 'https://www.instagram.com/reel/ABC/' })],
        {
          contentSourceId: 'cs-orig',
          userImportId: null,
          kind: 'reel',
          label: 'Found from this Reel',
          url: 'https://www.instagram.com/reel/ABC/',
          title: null,
          collectionId: null,
        },
      ),
      [],
    );
  });
});
