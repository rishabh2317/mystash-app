import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { railCardWidth, railPageIndex } from './rail';

const RELATED = { visible: 2, peek: 56, minWidth: 140, maxWidth: 200 };

describe('railPageIndex', () => {
  it('reports the nearest page for the current offset', () => {
    const page = (offsetX: number) => railPageIndex({ offsetX, itemPitch: 160, pageCount: 8 });
    assert.equal(page(0), 0);
    assert.equal(page(79), 0);
    assert.equal(page(81), 1);
    assert.equal(page(320), 2);
  });

  it('clamps to the available pages so overscroll never selects a missing dot', () => {
    assert.equal(railPageIndex({ offsetX: -120, itemPitch: 160, pageCount: 3 }), 0);
    assert.equal(railPageIndex({ offsetX: 9999, itemPitch: 160, pageCount: 3 }), 2);
  });

  it('keeps every dot reachable when the rail overflows by less than a card', () => {
    // Three 148pt cards on a 390pt phone scroll only 66pt, so pitch-based
    // paging would leave the last two dots permanently inactive.
    const geometry = { itemPitch: 160, pageCount: 3, maxOffsetX: 66 };
    assert.equal(railPageIndex({ offsetX: 0, ...geometry }), 0);
    assert.equal(railPageIndex({ offsetX: 33, ...geometry }), 1);
    assert.equal(railPageIndex({ offsetX: 66, ...geometry }), 2);
  });

  it('reaches the last dot at the end of a long rail', () => {
    const geometry = { itemPitch: 160, pageCount: 8, maxOffsetX: 890 };
    assert.equal(railPageIndex({ offsetX: 890, ...geometry }), 7);
    assert.equal(railPageIndex({ offsetX: 9999, ...geometry }), 7);
  });

  it('ignores the measured offset once a full card of scroll exists per page', () => {
    assert.equal(
      railPageIndex({ offsetX: 320, itemPitch: 160, pageCount: 3, maxOffsetX: 480 }),
      2,
    );
  });

  it('falls back to the first page when the rail has no measurable geometry', () => {
    assert.equal(railPageIndex({ offsetX: 400, itemPitch: 0, pageCount: 3 }), 0);
    assert.equal(railPageIndex({ offsetX: 400, itemPitch: 160, pageCount: 0 }), 0);
    assert.equal(railPageIndex({ offsetX: 400, itemPitch: 160, pageCount: 1 }), 0);
    assert.equal(
      railPageIndex({ offsetX: 400, itemPitch: 0, pageCount: 3, maxOffsetX: 0 }),
      0,
    );
  });
});

describe('railCardWidth', () => {
  it('leaves a peek of the next card on a narrow phone', () => {
    const width = railCardWidth({ screenWidth: 320, gutter: 16, gap: 12, ...RELATED });
    const consumed = width * RELATED.visible + 12 * RELATED.visible;
    assert.ok(consumed < 320 - 16 * 2 + RELATED.peek, 'rail must overflow so it reads as scrollable');
  });

  it('stays inside the width bounds across supported widths', () => {
    for (const screenWidth of [320, 375, 390, 430, 768]) {
      const width = railCardWidth({ screenWidth, gutter: 16, gap: 12, ...RELATED });
      assert.ok(
        width >= RELATED.minWidth && width <= RELATED.maxWidth,
        `width ${width} out of bounds at ${screenWidth}`,
      );
    }
  });

  it('grows with the viewport until it reaches the maximum', () => {
    const narrow = railCardWidth({ screenWidth: 320, gutter: 16, gap: 12, ...RELATED });
    const wide = railCardWidth({ screenWidth: 430, gutter: 16, gap: 12, ...RELATED });
    assert.ok(wide >= narrow);
    assert.equal(railCardWidth({ screenWidth: 1024, gutter: 16, gap: 12, ...RELATED }), RELATED.maxWidth);
  });

  it('treats a non-positive visible count as a single slot instead of dividing by zero', () => {
    const width = railCardWidth({
      screenWidth: 390,
      gutter: 16,
      gap: 12,
      visible: 0,
      peek: 28,
      minWidth: 96,
      maxWidth: 150,
    });
    assert.equal(Number.isFinite(width), true);
    assert.equal(width, 150);
  });
});
