import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createAllowsSystemAlert,
  createPartialProductLinksMessage,
  createUnsupportedUrlFieldError,
} from './createFeedback';

describe('UX-CREATE-B.6 create feedback', () => {
  it('surfaces unsupported URL as an inline field error only when pasted and invalid', () => {
    assert.equal(createUnsupportedUrlFieldError('', false), null);
    assert.equal(createUnsupportedUrlFieldError('https://youtube.com/shorts/abc', true), null);
    assert.match(
      createUnsupportedUrlFieldError('https://example.com/x', false) ?? '',
      /YouTube Short or Instagram Reel/i,
    );
  });

  it('formats partial manual link failures for inline notice, not Alert', () => {
    assert.equal(createPartialProductLinksMessage([]), null);
    assert.match(createPartialProductLinksMessage(['https://a.com/1']) ?? '', /https:\/\/a\.com\/1/);
  });

  it('allows system Alert only for discard confirms', () => {
    assert.equal(createAllowsSystemAlert('discard'), true);
    assert.equal(createAllowsSystemAlert('other'), false);
  });
});
