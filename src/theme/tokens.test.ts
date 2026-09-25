import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  OUTLINE_BORDER_VARIANT,
  getThemeTokens,
  mediaScrimGradient,
  outlineCardChrome,
  pageCanvasGradient,
  softCanvasGradient,
} from './tokens';

/** RGB channels of a `#rrggbb` token value. */
function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

describe('theme tokens', () => {
  it('exposes the same semantic keys for Titanium and Nebula', () => {
    const t = getThemeTokens('titanium');
    const n = getThemeTokens('nebula');
    assert.deepEqual(Object.keys(t.color).sort(), Object.keys(n.color).sort());
    assert.deepEqual(Object.keys(t.semantic).sort(), Object.keys(n.semantic).sort());
    assert.equal(t.space.md, 16);
    assert.equal(n.radius.md, 12);
    assert.equal(t.motion.themeMs, 300);
    assert.equal(t.motion.thumbnailFadeMs, 300);
    assert.equal(t.motion.thumbnailFadeReducedMs, 80);
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
    assert.deepEqual(pageCanvasGradient(t), ['#FFFFFF', '#F7F7F7']);
    assert.deepEqual(softCanvasGradient(t), ['#FFFFFF', '#F5F5F5']);
  });

  it('keeps the primary colour identical in both modes', () => {
    const t = getThemeTokens('titanium');
    const n = getThemeTokens('nebula');
    assert.equal(t.color.primary, n.color.primary);
    assert.equal(t.color.onPrimary, n.color.onPrimary);
    assert.notEqual(t.color.primary, t.color.onPrimary);
  });

  it('keeps immersive on-media tokens mode-invariant', () => {
    const t = getThemeTokens('titanium');
    const n = getThemeTokens('nebula');
    assert.deepEqual(t.immersive, n.immersive);
    /** Content on media is always light; it must not flip with the theme. */
    assert.equal(t.immersive.text, '#FFFFFF');
    assert.equal(t.immersive.icon, '#FFFFFF');
    assert.notEqual(t.immersive.surface, t.color.surface);
  });

  it('keeps dark mode neutral near-black so pages match the immersive feed', () => {
    const n = getThemeTokens('nebula');
    // Surfaces are white-alpha, so these opaque values decide the theme's hue.
    // Any colour cast here tints every card layered on top of them.
    for (const [name, value] of [
      ['canvas', n.color.canvas],
      ['canvasEnd', n.color.canvasEnd],
      ['canvasSoft', n.color.canvasSoft],
      ['canvasSoftEnd', n.color.canvasSoftEnd],
      ['tabBar', n.color.tabBar],
    ] as const) {
      const [r, g, b] = channels(value);
      assert.ok(
        Math.max(r, g, b) - Math.min(r, g, b) <= 4,
        `${name} (${value}) must be neutral, not tinted`,
      );
      assert.ok(Math.max(r, g, b) <= 0x1a, `${name} (${value}) must be near-black`);
    }
    assert.equal(n.color.text, '#FFFFFF');
    assert.equal(n.color.icon, '#FFFFFF');
  });

  it('keeps outline information cards transparent with a quiet border', () => {
    for (const mode of ['titanium', 'nebula'] as const) {
      const tokens = getThemeTokens(mode);
      assert.equal(tokens.color.outlineCard, 'transparent');
      assert.equal(tokens.semantic.surface.outlineCard, 'transparent');
      assert.notEqual(tokens.semantic.surface.outlineCard, tokens.semantic.surface.canvas);
      assert.equal(tokens.semantic.border.subtle, tokens.color.border);
      assert.equal(tokens.semantic.text.primary, tokens.color.text);
      assert.equal(tokens.semantic.text.secondary, tokens.color.textMuted);
      assert.equal(tokens.semantic.accent, tokens.color.primary);
      const chrome = outlineCardChrome(tokens);
      assert.equal(chrome.backgroundColor, 'transparent');
      assert.equal(chrome.borderColor, tokens.semantic.border.subtle);
    }
  });

  it('defaults the outline border experiment to refined (Mystash baseline)', () => {
    assert.equal(OUTLINE_BORDER_VARIANT, 'refined');
    const t = getThemeTokens('titanium');
    const n = getThemeTokens('nebula');
    assert.equal(t.color.border, 'rgba(0,0,0,0.08)');
    assert.equal(n.color.border, 'rgba(255,255,255,0.10)');
    assert.equal(t.elevation.card, 0);
    assert.equal(outlineCardChrome(t).borderColor, t.color.border);
    assert.equal(outlineCardChrome(n).borderColor, n.color.border);
  });

  it('keeps immersive / media-first tokens distinct from outline card chrome', () => {
    const t = getThemeTokens('titanium');
    assert.notEqual(t.immersive.stage, 'transparent');
    assert.notEqual(t.immersive.surface, outlineCardChrome(t).backgroundColor);
    assert.equal(t.immersive.text, '#FFFFFF');
  });

  it('exposes the scales the immersive feed depends on', () => {
    const t = getThemeTokens('titanium');
    assert.equal(t.fontSize.micro, 11);
    assert.equal(t.fontSize.label, 13);
    assert.ok(t.fontSize.caption < t.fontSize.bodyStrong);
    assert.ok(t.fontSize.section < t.fontSize.display);
    assert.equal(t.radius.xxl, 22);
    assert.equal(t.stroke.strong, 2);
    const scrim = mediaScrimGradient();
    assert.equal(scrim.colors.length, scrim.locations.length);
    assert.equal(scrim.colors[0], 'transparent');
  });
});
