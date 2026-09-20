/** Horizontal rail geometry shared by product / creator rails. */

/** Active page for a rail dot indicator from the current scroll offset. */
export function railPageIndex(input: {
  offsetX: number;
  itemPitch: number;
  pageCount: number;
  /** Furthest scrollable offset, measured by the rail. Omit while unmeasured. */
  maxOffsetX?: number;
}): number {
  const { offsetX, itemPitch, pageCount, maxOffsetX } = input;
  if (!(pageCount > 0)) return 0;
  const last = pageCount - 1;
  if (last === 0) return 0;

  // A rail with one dot per card can usually scroll a full card per dot. When
  // the content overflows by less than that — three cards on a wide phone, or
  // the tail of a long rail — snapping alone can never reach the trailing dots,
  // so page off scroll progress instead and every dot stays reachable.
  if (maxOffsetX !== undefined && maxOffsetX > 0 && maxOffsetX < last * itemPitch) {
    const progress = Math.min(1, Math.max(0, offsetX / maxOffsetX));
    return Math.round(progress * last);
  }

  if (!(itemPitch > 0)) return 0;
  return Math.min(last, Math.max(0, Math.round(offsetX / itemPitch)));
}

/**
 * Card width for a rail that shows `visible` cards plus a peek of the next one,
 * so the user can see the rail is scrollable without a scrollbar.
 */
export function railCardWidth(input: {
  screenWidth: number;
  gutter: number;
  gap: number;
  visible: number;
  peek: number;
  minWidth: number;
  maxWidth: number;
}): number {
  const { screenWidth, gutter, gap, visible, peek, minWidth, maxWidth } = input;
  const available = Math.max(0, screenWidth - gutter * 2);
  const slots = Math.max(1, visible);
  const width = (available - gap * slots - peek) / slots;
  return Math.round(Math.max(minWidth, Math.min(maxWidth, width)));
}
