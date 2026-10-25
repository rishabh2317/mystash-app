import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROFILE_AVATAR_PX, squareCropOrigin, versionedAvatarObjectPath } from './profilePhoto';

describe('profile photo normalization', () => {
  it('crops to a centered square and versions the object path', () => {
    assert.equal(PROFILE_AVATAR_PX, 384);
    assert.deepEqual(squareCropOrigin(1920, 1080), {
      originX: 420,
      originY: 0,
      width: 1080,
      height: 1080,
    });
    assert.equal(versionedAvatarObjectPath('user-1', 1700000000000, 'jpg'), 'user-1/avatar-1700000000000.jpg');
  });

  it('uploads ArrayBuffer from expo-file-system, not fetch(file://) Blob', () => {
    const src = readFileSync(join(process.cwd(), 'src/services/profilePhotoUpload.ts'), 'utf8');
    assert.match(src, /from 'expo-file-system'/);
    assert.match(src, /file\.bytes\(\)/);
    assert.match(src, /contentType: 'image\/jpeg'/);
    assert.match(src, /PROFILE_PHOTOS_BUCKET/);
    assert.doesNotMatch(src, /fetch\(localUri\)/);
    assert.doesNotMatch(src, /\.blob\(\)/);
  });
});
