import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  CARD_SURFACE_VARIANT,
  FIND_CAPTURE_ACTION_COLORS,
  FILTER_CHIP_DEPTH,
  OUTLINE_BORDER_VARIANT,
  TITANIUM_EXPERIMENT,
  getThemeTokens,
  informationCardShadow,
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
  it('keeps Find capture icons legible and the dark selected filter clearly distinct', () => {
    const luminance = (hex: string) => channels(hex).map(value => {
      const v = value / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
    for (const mode of ['titanium', 'nebula'] as const) {
      const colors = FIND_CAPTURE_ACTION_COLORS[mode];
      assert.ok(contrast(colors.icon, colors.surface) >= 3);
      assert.ok(contrast(getThemeTokens(mode).color.text, colors.surface) >= 4.5);
    }
    assert.ok(contrast(FILTER_CHIP_DEPTH.nebula.pressedFace[1], FILTER_CHIP_DEPTH.nebula.raisedFace[1]) >= 1.5);
  });

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
    if (CARD_SURFACE_VARIANT === 'raised') {
      assert.equal(t.color.accent, TITANIUM_EXPERIMENT.accent);
    } else {
      assert.equal(t.color.accent, '#000000');
    }
    assert.equal(n.color.accent, '#FFFFFF');
  });

  it('provides page and soft gradients for existing surface washes', () => {
    const t = getThemeTokens('titanium');
    if (CARD_SURFACE_VARIANT === 'raised') {
      assert.deepEqual(pageCanvasGradient(t), [
        TITANIUM_EXPERIMENT.canvas,
        TITANIUM_EXPERIMENT.canvasEnd,
      ]);
      assert.deepEqual(softCanvasGradient(t), [
        TITANIUM_EXPERIMENT.canvasSoft,
        TITANIUM_EXPERIMENT.canvasSoftEnd,
      ]);
    } else {
      assert.deepEqual(pageCanvasGradient(t), ['#FFFFFF', '#F7F7F7']);
      assert.deepEqual(softCanvasGradient(t), ['#FFFFFF', '#F5F5F5']);
    }
  });

  it('keeps Nebula primary independent of the Titanium light experiment', () => {
    const t = getThemeTokens('titanium');
    const n = getThemeTokens('nebula');
    assert.equal(n.color.primary, '#FFFFFF');
    assert.equal(n.color.onPrimary, '#000000');
    if (CARD_SURFACE_VARIANT === 'raised') {
      assert.equal(t.color.primary, TITANIUM_EXPERIMENT.primary);
      assert.equal(t.color.onPrimary, TITANIUM_EXPERIMENT.onPrimary);
      assert.notEqual(t.color.primary, n.color.primary);
    } else {
      assert.equal(t.color.primary, '#000000');
    }
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

  it('keeps information-card chrome and Titanium-only shadow centralized', () => {
    assert.ok(['outline', 'raised'].includes(CARD_SURFACE_VARIANT));
    for (const mode of ['titanium', 'nebula'] as const) {
      const tokens = getThemeTokens(mode);
      if (CARD_SURFACE_VARIANT === 'raised') {
        assert.notEqual(tokens.color.outlineCard, 'transparent');
        assert.notEqual(tokens.semantic.surface.outlineCard, 'transparent');
      } else {
        assert.equal(tokens.color.outlineCard, mode === 'titanium' ? 'transparent' : 'rgba(255, 255, 255, 0.07)');
        assert.equal(tokens.semantic.surface.outlineCard, tokens.color.outlineCard);
      }
      if(mode==='nebula'||CARD_SURFACE_VARIANT==='outline')assert.notEqual(tokens.semantic.surface.outlineCard, tokens.semantic.surface.canvas);
      else assert.equal(tokens.semantic.surface.outlineCard,TITANIUM_EXPERIMENT.card);
      assert.equal(tokens.semantic.border.subtle, tokens.color.border);
      assert.equal(tokens.semantic.text.primary, tokens.color.text);
      assert.equal(tokens.semantic.text.secondary, tokens.color.textMuted);
      assert.equal(tokens.semantic.accent, tokens.color.primary);
      const chrome = outlineCardChrome(tokens);
      assert.equal(chrome.backgroundColor, tokens.semantic.surface.outlineCard);
      assert.equal(
        chrome.borderColor,
        tokens.mode === 'titanium' && CARD_SURFACE_VARIANT === 'raised'
          ? TITANIUM_EXPERIMENT.cardBorder
          : tokens.semantic.border.subtle,
      );
    }
    const t = getThemeTokens('titanium');
    const n = getThemeTokens('nebula');
    if (CARD_SURFACE_VARIANT === 'raised') {
      assert.equal(t.color.outlineCard, TITANIUM_EXPERIMENT.card);
      assert.equal(t.color.canvas, TITANIUM_EXPERIMENT.canvas);
      assert.equal(t.color.canvasEnd, TITANIUM_EXPERIMENT.canvasEnd);
      assert.equal(t.color.canvasSoft, TITANIUM_EXPERIMENT.canvasSoft);
      assert.equal(t.color.primary, TITANIUM_EXPERIMENT.primary);
      const chrome = outlineCardChrome(t);
      assert.equal(chrome.backgroundColor, TITANIUM_EXPERIMENT.card);
      assert.equal(chrome.borderColor, TITANIUM_EXPERIMENT.cardBorder);
      assert.equal(n.color.outlineCard, 'rgba(255,255,255,0.09)');
      assert.equal(n.color.canvas, '#000000');
    }
    const chrome = outlineCardChrome(t);
    if (CARD_SURFACE_VARIANT === 'raised') {
      assert.equal(chrome.shadowOffset?.height, TITANIUM_EXPERIMENT.cardShadow.shadowOffset.height);
      assert.equal(chrome.shadowOpacity, TITANIUM_EXPERIMENT.cardShadow.shadowOpacity);
      assert.equal(chrome.shadowRadius, TITANIUM_EXPERIMENT.cardShadow.shadowRadius);
      assert.equal(chrome.elevation, TITANIUM_EXPERIMENT.cardShadow.elevation);
    } else {
      assert.deepEqual(informationCardShadow(t), {});
      assert.equal(chrome.shadowOpacity, undefined);
      assert.equal(chrome.elevation, undefined);
    }
    assert.equal(outlineCardChrome(n).shadowOpacity, undefined);
  });

  it('Titanium outline branch restores original canvas and transparent cards', () => {
    const src = readFileSync(join(process.cwd(), 'src/theme/tokens.ts'), 'utf8');
    assert.match(src, /canvas: TITANIUM_RAISED \? TITANIUM_EXPERIMENT\.canvas : '#FFFFFF'/);
    assert.match(src, /canvasEnd: TITANIUM_RAISED \? TITANIUM_EXPERIMENT\.canvasEnd : '#F7F7F7'/);
    assert.match(src, /canvasSoft: TITANIUM_RAISED \? TITANIUM_EXPERIMENT\.canvasSoft : '#FFFFFF'/);
    assert.match(src, /outlineCard: TITANIUM_RAISED \? TITANIUM_EXPERIMENT\.card : 'transparent'/);
  });

  it('keeps the selected outline border experiment unchanged', () => {
    assert.equal(OUTLINE_BORDER_VARIANT, 'crisp');
    const t = getThemeTokens('titanium');
    const n = getThemeTokens('nebula');
    assert.equal(t.color.border, 'rgba(0,0,0,0.14)');
    assert.equal(n.color.border, 'rgba(255,255,255,0.15)');
    assert.equal(t.elevation.card, 0);
    assert.equal(outlineCardChrome(t).borderColor,CARD_SURFACE_VARIANT==='raised'?TITANIUM_EXPERIMENT.cardBorder:t.color.border);
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
