import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { youtubeStageCropScale } from './feedYoutubeCrop';

describe('youtubeStageCropScale', () => {
  it('uses a stronger crop on the shorter Home stage than on a full window', () => {
    const windowScale = youtubeStageCropScale(844);
    const stageScale = youtubeStageCropScale(640);
    assert.ok(stageScale >= windowScale);
    assert.ok(stageScale <= 1.26);
    assert.ok(stageScale >= 1.1);
  });

  it('caps extreme short stages so the playable center is not over-cropped', () => {
    assert.equal(youtubeStageCropScale(200), 1.26);
  });

  it('returns a stable default before the stage has been measured', () => {
    assert.equal(youtubeStageCropScale(0), 1.16);
  });
});
