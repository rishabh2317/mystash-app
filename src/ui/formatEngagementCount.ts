/** Compact display for save/share counts on the feed action rail (e.g. 1.2K). */
export function formatEngagementCount(value: number): string {
  const n = Math.max(0, Math.floor(value));
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return k >= 10 ? `${Math.round(k)}K` : `${k.toFixed(1).replace(/\.0$/, '')}K`;
  }
  const m = n / 1_000_000;
  return m >= 10 ? `${Math.round(m)}M` : `${m.toFixed(1).replace(/\.0$/, '')}M`;
}
