/**
 * Scale the YouTube iframe so typical title/control chrome sits under Mystash
 * top bar + dock. Home stage is shorter than window height after HOME-2.
 * Does not change iframe player params and does not inject chrome-stripping JS.
 */
export function youtubeStageCropScale(stageHeightPx: number): number {
  const topChromePx = 52;
  const bottomChromePx = 68;
  const minScale = 1.1;
  const maxScale = 1.26;
  if (!(stageHeightPx > 0)) return 1.16;
  const inner = stageHeightPx - topChromePx - bottomChromePx;
  if (inner <= 0) return maxScale;
  const scale = stageHeightPx / inner;
  return Math.min(maxScale, Math.max(minScale, Math.round(scale * 1000) / 1000));
}
