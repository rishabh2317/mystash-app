import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getThemeTokens,
  mediaScrimGradient,
  pageCanvasGradient,
  softCanvasGradient,
} from './tokens';

describe('theme tokens', () => {
  it('exposes the same semantic keys for Titanium and Nebula', () => {
    const t = getThemeTokens('titanium');
    const n = getThemeTokens('nebula');
    assert.deepEqual(Object.keys(t.color).sort(), Object.keys(n.color).sort());
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
    assert.deepEqual(pageCanvasGradient(t), ['#F3F4F6', '#E5E7EB']);
    assert.deepEqual(softCanvasGradient(t), ['#FDFDFD', '#E8E8E8']);
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

  it('exposes the scales the immersive feed depends on', () => {
    const t = getThemeTokens('titanium');
    assert.equal(t.fontSize.micro, 11);
    assert.equal(t.fontSize.label, 13);
    assert.equal(t.radius.xxl, 22);
    assert.equal(t.stroke.strong, 2);
    const scrim = mediaScrimGradient();
    assert.equal(scrim.colors.length, scrim.locations.length);
    assert.equal(scrim.colors[0], 'transparent');
  });
});
