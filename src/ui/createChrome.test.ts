import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getThemeTokens } from '../theme/tokens';
import {
  createFieldColors,
  createPrimaryButtonStyle,
  createSegmentBadgeColors,
} from './createChrome';

describe('UX-CREATE-B.8 create chrome', () => {
  it('maps fields and primary CTA to theme tokens', () => {
    const tokens = getThemeTokens('titanium');
    const field = createFieldColors(tokens);
    assert.equal(field.color, tokens.color.text);
    assert.equal(field.backgroundColor, tokens.color.surface);
    assert.equal(createFieldColors(tokens, { invalid: true }).borderColor, tokens.color.danger);

    const btn = createPrimaryButtonStyle(tokens, { pending: true });
    assert.equal(btn.backgroundColor, tokens.color.cta);
    assert.equal(btn.opacity, 0.7);
  });

  it('uses semantic badge colors for draft segments', () => {
    const tokens = getThemeTokens('nebula');
    assert.equal(createSegmentBadgeColors(tokens, 'attention').fg, tokens.color.danger);
    assert.equal(createSegmentBadgeColors(tokens, 'processing').fg, tokens.color.warning);
    assert.equal(createSegmentBadgeColors(tokens, 'continue').fg, tokens.color.success);
  });
});
