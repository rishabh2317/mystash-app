import type { CreatorAnalyticsSummary } from '@/src/services/engagementApi';

export const ANALYTICS_COPY = {
  title: 'Analytics',
  emptyTitle: 'Nothing to report yet',
  emptyBody: 'Your analytics will appear here once people start discovering your collections.',
  signIn: 'Sign in to view analytics.',
  notCreator: 'Analytics are available after you start creating.',
  unavailable: 'Analytics unavailable right now.',
  headlineViews: 'Recorded collection views',
  followers: 'Current followers',
  saves: 'Current saves',
  shares: 'Shares',
  productClicks: 'Outbound clicks',
  topCollections: 'Top collections',
  lifetime: 'Current collections',
  definitionHint: 'Views include feed activations and collection opens. Clicks record merchant destination requests, not purchases.',
} as const;

export function analyticsTotalsAreEmpty(totals: CreatorAnalyticsSummary['totals']): boolean {
  return (
    totals.views === 0 &&
    totals.followers === 0 &&
    totals.saves === 0 &&
    totals.shares === 0 &&
    totals.productRedirects === 0
  );
}

export function rankAnalyticsCollections(
  collections: CreatorAnalyticsSummary['collections'],
): CreatorAnalyticsSummary['collections'] {
  return [...collections]
    .filter((c) => c.collectionId && (c.views > 0 || c.saves > 0 || c.shares > 0 || c.productRedirects > 0))
    .sort((a, b) => {
      if (b.views !== a.views) return b.views - a.views;
      if (b.productRedirects !== a.productRedirects) return b.productRedirects - a.productRedirects;
      if (b.saves !== a.saves) return b.saves - a.saves;
      return b.shares - a.shares;
    });
}

export function formatAnalyticsCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1000) return String(Math.floor(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
}

export function collectionAnalyticsLine(c: {
  views: number;
  saves: number;
  productRedirects: number;
}): string {
  const parts = [`${formatAnalyticsCount(c.views)} views`];
  if (c.saves > 0) parts.push(`${formatAnalyticsCount(c.saves)} saves`);
  if (c.productRedirects > 0) parts.push(`${formatAnalyticsCount(c.productRedirects)} clicks`);
  return parts.join(' · ');
}
