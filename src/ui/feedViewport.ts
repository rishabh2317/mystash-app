/** Home feed paging uses the measured list viewport, not window height. */

export function clampFeedIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(0, Math.floor(index)), length - 1);
}

/** Keep the same reel after an in-place reload; clamp if it disappeared. */
export function preserveFeedIndex(opts: {
  previousId: string | undefined;
  previousIndex: number;
  nextIds: readonly string[];
}): number {
  const { previousId, previousIndex, nextIds } = opts;
  if (previousId) {
    const found = nextIds.indexOf(previousId);
    if (found >= 0) return found;
  }
  return clampFeedIndex(previousIndex, nextIds.length);
}

export function feedItemLayout(itemHeight: number, index: number): {
  length: number;
  offset: number;
  index: number;
} {
  const height = itemHeight > 0 ? itemHeight : 0;
  return {
    length: height,
    offset: height * index,
    index,
  };
}

/** Next reel poster only — never a second player WebView. */
export function nextFeedThumbnailUrl(
  videos: ReadonlyArray<{ thumbnail?: string | null }>,
  activeIndex: number,
): string | null {
  if (activeIndex < 0) return null;
  const next = videos[activeIndex + 1];
  const uri = next?.thumbnail?.trim() ?? '';
  if (!uri.startsWith('http')) return null;
  return uri;
}
