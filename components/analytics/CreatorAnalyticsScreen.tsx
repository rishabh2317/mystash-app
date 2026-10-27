import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import type { CreatorMetric, CreatorRange, CreatorReport } from '@/backend/src/analytics/creatorReport';
import { TopBar } from '@/components/chrome/TopBar';
import { SkeletonBlock } from '@/components/status/SkeletonBlock';
import { ActionButton } from '@/components/ui/ActionButton';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { getCreatorReport } from '@/src/services/creatorReportApi';
import { EngagementApiError, getMyCreatorAnalytics, type CreatorAnalyticsSummary } from '@/src/services/engagementApi';
import { outlineCardChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import { collectionTilePressPath } from '@/src/ui/collectionLayout';
import { METRIC_LABELS, reportCount, trendGeometry, utcDateLabel } from '@/src/ui/creatorReport';

type Loaded = { key: string; report?: CreatorReport; current?: CreatorAnalyticsSummary | null; error?: string; forbidden?: boolean };
const RANGES: CreatorRange[] = [7, 30, 90];
const HEADLINES: CreatorMetric[] = ['collection_opens', 'saves_added', 'merchant_requests', 'followers_added'];
const TRENDS: CreatorMetric[] = ['collection_opens', 'collection_impressions', 'merchant_requests'];

export default function CreatorAnalyticsScreen() {
  const { tokens } = useThemeMode();
  const { user, loading } = useAuth();
  const router = useRouter();
  const { width, fontScale } = useWindowDimensions();
  const [days, setDays] = useState<CreatorRange>(7);
  const [refresh, setRefresh] = useState(0);
  const [metric, setMetric] = useState<CreatorMetric>('collection_opens');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = `${user?.id ?? ''}:${days}:${refresh}`;
  const result = loaded?.key === key ? loaded : null;
  const report = result?.report;
  const pending = loading || (!!user && !result);
  const twoColumns = width >= 340 && fontScale < 1.4;
  const card = [outlineCardChrome(tokens), { borderWidth: StyleSheet.hairlineWidth, borderRadius: tokens.radius.lg,
    padding: tokens.space.md, gap: tokens.space.sm }];

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    Promise.all([getCreatorReport(days, controller.signal), getMyCreatorAnalytics(controller.signal).catch(() => null)])
      .then(([next, current]) => { if (!cancelled) setLoaded({ key, report: next, current }); })
      .catch((error: unknown) => {
        if (!cancelled) setLoaded({ key,
          forbidden: error instanceof EngagementApiError && [401, 403].includes(error.statusCode),
          error: error instanceof EngagementApiError && error.statusCode === 403
            ? 'Analytics are available after you start creating.'
            : error instanceof EngagementApiError ? error.message : 'Analytics unavailable right now. Please try again.',
        });
      }).finally(() => clearTimeout(timeout));
    return () => { cancelled = true; controller.abort(); clearTimeout(timeout); };
  }, [key, days, loading, user]);

  const geometry = useMemo(() => trendGeometry(report?.series.map(d => d.values[metric]) ?? []), [report, metric]);
  const refreshReport = () => setRefresh(n => n + 1);
  const signed = (n: number) => `${n > 0 ? '+' : ''}${reportCount(n)}`;
  const hasObservations = report && Object.values(report.current.values).some(n => n !== null && n > 0);
  const rangeEnd = report ? new Date(Date.parse(`${report.current.end}T00:00:00Z`) - 86400000).toISOString().slice(0, 10) : '';

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <TopBar mode="page" title="Analytics" showBack />
      <ScrollView showsVerticalScrollIndicator={false}
        refreshControl={user ? <RefreshControl refreshing={pending} onRefresh={refreshReport} tintColor={tokens.color.primary} /> : undefined}
        contentContainerStyle={{ padding: tokens.space.lg, paddingTop: tokens.space.sm, paddingBottom: tokens.space.xxl, gap: tokens.space.lg }}>
        <View style={{ gap: tokens.space.sm }}>
          <Text style={typeStyle(tokens, 'identityTitle')}>Your creator insights</Text>
          <Text style={typeStyle(tokens, 'bodyMuted')}>Discover how people find, save and shop your public collections.</Text>
        </View>
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: tokens.space.sm }}>
          {RANGES.map(range => (
            <Pressable key={range} accessibilityRole="tab" accessibilityLabel={`Last ${range} complete UTC days`}
              accessibilityState={{ selected: days === range }} onPress={() => setDays(range)}
              style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', padding: tokens.space.sm,
                borderRadius: tokens.radius.pill, backgroundColor: days === range ? tokens.color.primarySurface : tokens.color.surfaceSubtle }}>
              <Text style={[typeStyle(tokens, 'tileTitle'), { color: days === range ? tokens.color.onPrimarySurface : tokens.color.textMuted }]}>{range} days</Text>
            </Pressable>
          ))}
        </View>
        {!user && !loading ? <View style={card}><Text style={typeStyle(tokens, 'bodyMuted')}>Sign in to view analytics.</Text></View>
          : pending ? <View accessibilityLabel="Loading creator analytics" accessibilityState={{ busy: true }} style={{ gap: tokens.space.md }}>
            <SkeletonBlock width="65%" height={20} /><SkeletonBlock height={150} /><SkeletonBlock height={220} />
          </View>
            : result?.error ? <View style={card} accessibilityLiveRegion="polite">
              <Text style={typeStyle(tokens, 'sectionTitle')}>{result.forbidden ? 'Creator access required' : 'Insights unavailable'}</Text>
              <Text style={typeStyle(tokens, 'bodyMuted')}>{result.error}</Text>
              {!result.forbidden && <ActionButton label="Try again" onPress={refreshReport} variant="secondary" />}
            </View>
              : report ? <>
                <View style={{ gap: tokens.space.xs }}>
                  <Text style={typeStyle(tokens, 'tileTitle')}>{utcDateLabel(report.current.start)} – {utcDateLabel(rangeEnd)}</Text>
                  <Text style={typeStyle(tokens, 'tileMeta')}>Complete UTC days · {report.current.coveredDays}/{days} days with continuous worker coverage</Text>
                  <Text style={typeStyle(tokens, 'tileMeta')}>{report.refreshedAt ? `Updated ${new Date(report.refreshedAt).toLocaleString()}` : 'Awaiting the first aggregation'}</Text>
                </View>
                <View style={[...card, { backgroundColor: tokens.color.surfaceSubtle }]}>
                  <Text style={typeStyle(tokens, 'tileTitle')}>{report.stale ? 'Updates delayed' : report.current.coveredDays < days ? 'Partial measurement coverage' : 'Recorded activity'}</Text>
                  <Text style={typeStyle(tokens, 'bodyMuted')}>Counts reflect recorded interactions, not unique people. Optional measurement includes people who opted in. Coverage samples worker availability, not every device. Gaps are unknown; a dash does not mean zero.</Text>
                  {report.provisional && <Text style={typeStyle(tokens, 'tileMeta')}>Recent counts are provisional while delayed events arrive.</Text>}
                  {!hasObservations && <Text style={typeStyle(tokens, 'bodyMuted')}>{report.current.coveredDays === days ? 'No recorded activity in this range.' : 'Not enough recorded activity in this range yet.'}</Text>}
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm }}>
                  {HEADLINES.map(name => <View key={name} style={[...card, { width: twoColumns ? '48%' : '100%', flexGrow: 1 }]}>
                    <Text style={typeStyle(tokens, 'tileMeta')}>{METRIC_LABELS[name]}</Text>
                    <Text style={typeStyle(tokens, 'identityTitle')}>{reportCount(report.current.values[name])}</Text>
                    <Text style={typeStyle(tokens, 'tileMeta')}>{report.changes[name] === null ? 'Comparison unavailable' : `${signed(report.changes[name]!)}% vs previous ${days} days`}</Text>
                  </View>)}
                </View>
                <View style={card}>
                  <Text style={typeStyle(tokens, 'sectionTitle')}>Activity over time</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.xs }}>
                    {TRENDS.map(name => <Pressable key={name} accessibilityRole="button" accessibilityState={{ selected: metric === name }}
                      onPress={() => setMetric(name)} style={{ minHeight: 44, justifyContent: 'center', padding: tokens.space.sm,
                        borderRadius: tokens.radius.md, backgroundColor: metric === name ? tokens.color.primarySurface : tokens.color.surfaceSubtle }}>
                      <Text style={[typeStyle(tokens, 'tileMeta'), { color: metric === name ? tokens.color.onPrimarySurface : tokens.color.text }]}>{METRIC_LABELS[name]}</Text>
                    </Pressable>)}
                  </View>
                  <Text style={typeStyle(tokens, 'tileMeta')}>{geometry.max.toLocaleString()}</Text>
                  <View accessible accessibilityRole="image" accessibilityLabel={`${METRIC_LABELS[metric]}. ${report.series.map(d => `${utcDateLabel(d.day)}: ${d.values[metric] === null ? 'unknown' : d.values[metric]}${d.covered ? '' : ', partial coverage'}`).join('; ')}`}>
                    <Svg width="100%" height={128} viewBox="0 0 320 112" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                      <Line x1={8} y1={104} x2={312} y2={104} stroke={tokens.color.divider} strokeWidth={1} />
                      {geometry.paths.map((d, i) => <Path key={i} d={d} stroke={tokens.color.primary} fill="none" strokeWidth={2} />)}
                      {geometry.points.map((p, i) => p && <Circle key={i} cx={p.x} cy={p.y} r={2.5} fill={tokens.color.primary} />)}
                    </Svg>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={typeStyle(tokens, 'tileMeta')}>0 · {utcDateLabel(report.current.start)}</Text>
                    <Text style={typeStyle(tokens, 'tileMeta')}>{utcDateLabel(rangeEnd)}</Text>
                  </View>
                  <Text style={typeStyle(tokens, 'tileMeta')}>Unknown days remain gaps. Partial days show recorded counts only.</Text>
                </View>
                <View style={card}>
                  <Text style={typeStyle(tokens, 'sectionTitle')}>Audience & engagement</Text>
                  {(['followers_added', 'followers_removed', 'saves_added', 'saves_removed', 'collection_shares', 'likes_added', 'likes_removed', 'profile_opens', 'collection_impressions', 'product_impressions'] as CreatorMetric[]).map(name =>
                    <View key={name} style={styles.statRow}><Text style={[typeStyle(tokens, 'bodyMuted'), { flex: 1 }]}>{METRIC_LABELS[name]}</Text><Text style={typeStyle(tokens, 'tileTitle')}>{reportCount(report.current.values[name])}</Text></View>)}
                  <Text style={typeStyle(tokens, 'tileMeta')}>Saves and follows count additions and removals in this range. Impressions require at least half the card to be visible for one second. Merchant requests record resolved outbound destinations, not purchases or confirmed arrivals.</Text>
                </View>
                <View style={{ gap: tokens.space.sm }}>
                  <Text style={typeStyle(tokens, 'sectionTitle')}>Top collections</Text>
                  <Text style={typeStyle(tokens, 'tileMeta')}>Ranked by recorded opens, then merchant requests and saves.</Text>
                  {report.topCollections.length ? report.topCollections.map(c => <Pressable key={c.id} accessibilityRole="button"
                    onPress={() => router.push(collectionTilePressPath(c.id))} style={[...card, styles.contentRow]}>
                    {c.thumbnail_url ? <Image source={{ uri: c.thumbnail_url }} style={styles.thumb} contentFit="cover" /> : <View style={[styles.thumb, { backgroundColor: tokens.color.surfaceSubtle }]} />}
                    <View style={{ flex: 1, gap: tokens.space.xs }}><Text style={typeStyle(tokens, 'tileTitle')} numberOfLines={2}>{c.title?.trim() || 'Collection'}</Text>
                      <Text style={typeStyle(tokens, 'tileMeta')}>{reportCount(c.opens)} opens · {reportCount(c.saves)} saves · {reportCount(c.requests)} requests</Text></View>
                  </Pressable>) : <View style={card}><Text style={typeStyle(tokens, 'bodyMuted')}>No opens, saves or merchant requests recorded in this range.</Text></View>}
                </View>
                <View style={{ gap: tokens.space.sm }}>
                  <Text style={typeStyle(tokens, 'sectionTitle')}>Top products</Text>
                  <Text style={typeStyle(tokens, 'tileMeta')}>Attributed through your public collections. Ranked by merchant requests, then impressions.</Text>
                  {report.topProducts.length ? report.topProducts.map(p => <View key={`${p.namespace}:${p.id}`} style={[...card, styles.contentRow]}>
                    {p.thumbnail_url ? <Image source={{ uri: p.thumbnail_url }} style={styles.productThumb} contentFit="contain" /> : <View style={[styles.productThumb, { backgroundColor: tokens.color.surfaceSubtle }]} />}
                    <View style={{ flex: 1, gap: tokens.space.xs }}><Text style={typeStyle(tokens, 'tileTitle')} numberOfLines={2}>{p.title}</Text>
                      <Text style={typeStyle(tokens, 'tileMeta')}>{reportCount(p.impressions)} impressions · {reportCount(p.requests)} requests</Text></View>
                  </View>) : <View style={card}><Text style={typeStyle(tokens, 'bodyMuted')}>No attributed product activity recorded in this range.</Text></View>}
                </View>
                <View style={card}>
                  <Text style={typeStyle(tokens, 'sectionTitle')}>Current totals</Text>
                  <Text style={typeStyle(tokens, 'tileMeta')}>Current relationships, independent of the date range above. Saves cover your current collections.</Text>
                  <View style={styles.statRow}><Text style={typeStyle(tokens, 'bodyMuted')}>Followers</Text><Text style={typeStyle(tokens, 'tileTitle')}>{reportCount(result?.current?.totals.followers ?? null)}</Text></View>
                  <View style={styles.statRow}><Text style={typeStyle(tokens, 'bodyMuted')}>Collection saves</Text><Text style={typeStyle(tokens, 'tileTitle')}>{reportCount(result?.current?.totals.saves ?? null)}</Text></View>
                  {!result?.current && <Text style={typeStyle(tokens, 'tileMeta')}>Current totals unavailable. Pull to refresh to retry.</Text>}
                </View>
                <Text style={typeStyle(tokens, 'tileMeta')}>Only your currently public, published collections are included in range metrics. Counts may change when content is removed. Historical coverage gaps prevent reliable comparisons. No revenue or purchase attribution is inferred.</Text>
              </> : null}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, paddingVertical: 4 },
  contentRow: { flexDirection: 'row', alignItems: 'center' },
  thumb: { width: 56, height: 72, borderRadius: 8 },
  productThumb: { width: 56, height: 56, borderRadius: 8 },
});
