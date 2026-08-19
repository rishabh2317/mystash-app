import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getThemeTokens, pageCanvasGradient, softCanvasGradient } from './tokens';

describe('theme tokens', () => {
  it('exposes the same semantic keys for Titanium and Nebula', () => {
    const t = getThemeTokens('titanium');
    const n = getThemeTokens('nebula');
    assert.deepEqual(Object.keys(t.color).sort(), Object.keys(n.color).sort());
    assert.equal(t.space.md, 16);
    assert.equal(n.radius.md, 12);
    assert.equal(t.motion.themeMs, 300);
  });

  it('keeps modes visually distinct while sharing type/space', () => {
    const t = getThemeTokens('titanium');
    const n = getThemeTokens('nebula');
    assert.notEqual(t.color.text, n.color.text);
    assert.notEqual(t.color.canvas, n.color.canvas);
    assert.notEqual(t.color.accent, t.color.cta);
    assert.equal(t.fontSize.body, n.fontSize.body);
    assert.equal(t.color.accent, '#00AFC0');
    assert.equal(n.color.accent, '#A855F7');
  });

  it('provides page and soft gradients for existing surface washes', () => {
    const t = getThemeTokens('titanium');
    assert.deepEqual(pageCanvasGradient(t), ['#F3F4F6', '#E5E7EB']);
    assert.deepEqual(softCanvasGradient(t), ['#FDFDFD', '#E8E8E8']);
  });
});
