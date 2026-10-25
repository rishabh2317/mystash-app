/** Lightweight Home feed page. Products stay off this payload. */
export const FEED_PAGE_SIZE = 8;

export const FEED_VIDEO_COLUMNS =
  'id, url, thumbnail, creator_name, stash_score, product_name, embed_url, video_title, curator_id, collection_id, created_at';

export function feedPageRange(page: number, pageSize = FEED_PAGE_SIZE): { from: number; to: number } {
  const safe = Number.isFinite(page) ? Math.max(0, Math.floor(page)) : 0;
  const from = safe * pageSize;
  return { from, to: from + pageSize - 1 };
}

export function feedHasMore(rowCount: number, pageSize = FEED_PAGE_SIZE): boolean {
  return rowCount >= pageSize;
}

/** One WebView, and only for the reel that is actually active. */
export function shouldMountFeedPlayer(isActive: boolean, embedUrl: string | null | undefined): boolean {
  return Boolean(isActive && embedUrl && embedUrl.trim());
}

export function countMountedFeedPlayers(mounted: readonly boolean[]): number {
  return mounted.reduce((count, active) => count + (active ? 1 : 0), 0);
}

export type FeedViewToken = {
  index: number | null;
  isViewable: boolean;
  percent?: number | null;
};

/** Prefer the most visible reel. Ignore tokens that just left the viewport. */
export function pickActiveFeedIndex(tokens: readonly FeedViewToken[]): number | null {
  let best: { index: number; percent: number } | null = null;
  for (const token of tokens) {
    if (!token.isViewable || typeof token.index !== 'number' || token.index < 0) continue;
    const percent = typeof token.percent === 'number' ? token.percent : 100;
    if (
      !best ||
      percent > best.percent ||
      (percent === best.percent && token.index < best.index)
    ) {
      best = { index: token.index, percent };
    }
  }
  return best?.index ?? null;
}
