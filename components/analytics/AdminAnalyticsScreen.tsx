import React, { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import type { AdminMetric, AdminReport } from '@/backend/src/analytics/adminReport';
import type { CreatorRange } from '@/backend/src/analytics/creatorReport';
import { TopBar } from '@/components/chrome/TopBar';
import { SkeletonBlock } from '@/components/status/SkeletonBlock';
import { ActionButton } from '@/components/ui/ActionButton';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { getAdminReport } from '@/src/services/adminReportApi';
import { EngagementApiError } from '@/src/services/engagementApi';
import { outlineCardChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import { ADMIN_LABELS, HEALTH_LABELS, SNAPSHOT_LABELS, adminMetricValue } from '@/src/ui/adminAnalytics';
import { trendGeometry, utcDateLabel } from '@/src/ui/creatorReport';

type Loaded = { key: string; report?: AdminReport; error?: string; denied?: boolean };
const HEADLINES: AdminMetric[] = ['search_responses', 'product_opens', 'merchant_requests', 'saves_added'];
const TRENDS: AdminMetric[] = ['search_responses', 'product_opens', 'merchant_requests'];
const ENGAGEMENT: AdminMetric[] = ['app_sessions', 'collection_opens', 'collection_impressions', 'product_impressions', 'place_impressions', 'place_outbound_requests', 'profile_opens', 'saves_added', 'saves_removed', 'follows_added', 'follows_removed', 'likes_added', 'likes_removed', 'collection_shares', 'affiliate_requests'];
export default function AdminAnalyticsScreen() {
  const { tokens } = useThemeMode();
  const { user, loading } = useAuth();
  const { width, fontScale } = useWindowDimensions();
  const [days, setDays] = useState<CreatorRange>(7);
  const [refresh, setRefresh] = useState(0);
  const [metric, setMetric] = useState<AdminMetric>('search_responses');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = `${user?.id ?? ''}:${days}:${refresh}`;
  const result = loaded?.key === key ? loaded : null;
  const report = result?.report;
  const pending = loading || (!!user && !result);
  const card = [outlineCardChrome(tokens), { borderWidth: StyleSheet.hairlineWidth, borderRadius: tokens.radius.lg, padding: tokens.space.md, gap: tokens.space.sm }];
  const retry = () => setRefresh(n => n + 1);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') { setLoaded(null); setRefresh(n => n + 1); } });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!user || loading) return;
    let cancelled = false;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    getAdminReport(days, controller.signal, user.id).then(next => { if (!cancelled) setLoaded({ key, report: next }); })
      .catch((error: unknown) => { if (!cancelled) setLoaded({ key, denied: error instanceof EngagementApiError && [401, 403].includes(error.statusCode), error: error instanceof EngagementApiError ? error.message : 'Unable to load admin analytics. Please retry.' }); })
      .finally(() => clearTimeout(timer));
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [key, user, loading, days]);
  const geometry = useMemo(() => trendGeometry(report?.series.map(d => d.values[metric]) ?? []), [report, metric]);
  const row = (label: string, value: string, id = label) => <View key={id} style={styles.row}><Text style={[typeStyle(tokens, 'bodyMuted'), { flex: 1 }]}>{label}</Text><Text style={typeStyle(tokens, 'tileTitle')}>{value}</Text></View>;
  const value = adminMetricValue;
  const endLabel = report ? utcDateLabel(new Date(Date.parse(`${report.current.end}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)) : '';
  return <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
    <TopBar mode="page" title="Admin analytics" showBack />
    <ScrollView showsVerticalScrollIndicator={false} refreshControl={user ? <RefreshControl refreshing={pending} onRefresh={retry} tintColor={tokens.color.primary} /> : undefined}
      contentContainerStyle={{ padding: tokens.space.lg, paddingTop: tokens.space.sm, paddingBottom: tokens.space.xxl, gap: tokens.space.lg }}>
      <View style={{ gap: tokens.space.sm }}><Text style={typeStyle(tokens, 'identityTitle')}>Product & operations</Text><Text style={typeStyle(tokens, 'bodyMuted')}>Restricted aggregate reporting. Business records and optional measurement are labelled separately.</Text></View>
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: tokens.space.sm }}>{([7, 30, 90] as CreatorRange[]).map(n => <Pressable key={n} onPress={() => setDays(n)} accessibilityRole="tab" accessibilityState={{ selected: days === n }} accessibilityLabel={`Last ${n} complete UTC days`}
        style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', padding: tokens.space.sm, borderRadius: tokens.radius.pill, backgroundColor: days === n ? tokens.color.primarySurface : tokens.color.surfaceSubtle }}>
        <Text style={[typeStyle(tokens, 'tileTitle'), { color: days === n ? tokens.color.onPrimarySurface : tokens.color.textMuted }]}>{n} days</Text></Pressable>)}</View>
      {!user && !loading ? <View style={card}><Text style={typeStyle(tokens, 'bodyMuted')}>Sign in with an authorized admin account.</Text></View>
        : pending ? <View accessibilityLabel="Loading admin report" accessibilityState={{ busy: true }} style={{ gap: tokens.space.md }}><SkeletonBlock height={140} /><SkeletonBlock height={200} /></View>
          : result?.error ? <View style={card} accessibilityLiveRegion="polite"><Text style={typeStyle(tokens, 'sectionTitle')}>{result.denied ? 'Admin access required' : 'Report unavailable'}</Text><Text style={typeStyle(tokens, 'bodyMuted')}>{result.error}</Text>{!result.denied && <ActionButton label="Try again" onPress={retry} variant="secondary" />}</View>
            : report ? <>
              <View style={card}><Text style={typeStyle(tokens, 'tileTitle')}>{utcDateLabel(report.current.start)} – {endLabel} · UTC</Text>
                <Text style={typeStyle(tokens, 'bodyMuted')}>{report.stale ? 'Aggregation updates are delayed.' : 'Recorded measurement'} · {report.current.coveredDays}/{days} days with continuous worker coverage.</Text>
                <Text style={typeStyle(tokens, 'tileMeta')}>Coverage samples worker availability, not every device. Optional events reflect opted-in measurement. Dashes mean unknown; partial counts are not population totals.</Text>
                <Text style={typeStyle(tokens, 'tileMeta')}>{report.refreshedAt ? `Aggregates updated ${new Date(report.refreshedAt).toLocaleString()}` : 'Awaiting the first aggregation'}{report.provisional ? ' · Recent counts are provisional.' : ''}</Text></View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm }}>{HEADLINES.map(name => <View key={name} style={[...card, { width: width >= 340 && fontScale < 1.4 ? '48%' : '100%', flexGrow: 1 }]}>
                <Text style={typeStyle(tokens, 'tileMeta')}>{ADMIN_LABELS[name]}</Text><Text style={typeStyle(tokens, 'identityTitle')}>{value(report.current.values[name])}</Text>
                <Text style={typeStyle(tokens, 'tileMeta')}>{report.changes[name] === null ? 'Comparison unavailable' : `${report.changes[name]! > 0 ? '+' : ''}${report.changes[name]}% vs previous ${days} days`}</Text></View>)}</View>
              <View style={card}><Text style={typeStyle(tokens, 'sectionTitle')}>Discovery trends</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.xs }}>{TRENDS.map(name => <Pressable key={name} onPress={() => setMetric(name)} accessibilityRole="button" accessibilityState={{ selected: metric === name }}
                style={{ minHeight: 44, padding: tokens.space.sm, justifyContent: 'center', borderRadius: tokens.radius.md, backgroundColor: metric === name ? tokens.color.primarySurface : tokens.color.surfaceSubtle }}><Text style={typeStyle(tokens, 'tileMeta')}>{ADMIN_LABELS[name]}</Text></Pressable>)}</View>
                <Text style={typeStyle(tokens, 'tileMeta')}>{value(geometry.max)}</Text>
                <View accessible accessibilityRole="image" accessibilityLabel={`${ADMIN_LABELS[metric]}. ${report.series.map(d => `${utcDateLabel(d.day)}: ${d.values[metric] === null ? 'unknown' : d.values[metric]}${d.covered ? '' : ', partial coverage'}`).join('; ')}`}>
                  <Svg width="100%" height={128} viewBox="0 0 320 112" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Line x1={8} y1={104} x2={312} y2={104} stroke={tokens.color.divider} />{geometry.paths.map((d, i) => <Path key={i} d={d} fill="none" stroke={tokens.color.primary} strokeWidth={2} />)}{geometry.points.map((p, i) => p && <Circle key={i} cx={p.x} cy={p.y} r={2.5} fill={tokens.color.primary} />)}</Svg></View>
                <View style={styles.row}><Text style={typeStyle(tokens, 'tileMeta')}>0 · {utcDateLabel(report.current.start)}</Text><Text style={typeStyle(tokens, 'tileMeta')}>{endLabel}</Text></View><Text style={typeStyle(tokens, 'tileMeta')}>Unknown days remain gaps. Interactions are not unique people.</Text></View>
              <View style={card}><Text style={typeStyle(tokens, 'sectionTitle')}>Search quality</Text>
                {row('No matching results', value(report.search.zeroMatchPercent, '%'))}{row('Fallback used', value(report.search.fallbackPercent, '%'))}{row('Mean response latency', value(report.search.meanLatencyMs, ' ms'))}{row('Mean clicked rank', value(report.search.meanClickRank))}{row('Recorded result clicks', value(report.current.values.search_clicks))}
                <Text style={typeStyle(tokens, 'tileMeta')}>Rates use recorded typed first-page responses. Fallback products do not count as matching results. Click ranks are one-based. These are not matched click-through or conversion rates.</Text>
                {report.filters.length > 0 && <Text style={typeStyle(tokens, 'tileTitle')}>Filters on recorded responses</Text>}{report.filters.map(f => row(f.filter, value(f.responses), `filter:${f.filter}`))}</View>
              <View style={card}><Text style={typeStyle(tokens, 'sectionTitle')}>Category interest</Text><Text style={typeStyle(tokens, 'tileMeta')}>Canonical catalog categories only; other products are grouped as other. Ranked by merchant requests, then product opens.</Text>
                {report.categories.length ? report.categories.map(c => <View key={c.category} style={{ gap: tokens.space.xs, paddingVertical: tokens.space.xs }}><Text style={typeStyle(tokens, 'tileTitle')}>{c.category}</Text><Text style={typeStyle(tokens, 'tileMeta')}>{value(c.values.product_impressions)} impressions · {value(c.values.product_opens)} opens · {value(c.values.merchant_requests)} requests</Text></View>) : <Text style={typeStyle(tokens, 'bodyMuted')}>No recorded category activity in this range.</Text>}</View>
              <View style={card}><Text style={typeStyle(tokens, 'sectionTitle')}>Engagement & shopping intent</Text>{ENGAGEMENT.map(name => row(ADMIN_LABELS[name], value(report.current.values[name]), name))}<Text style={typeStyle(tokens, 'tileMeta')}>App session starts are not people. Operational additions/removals count committed actions. Merchant/affiliate requests resolve destinations; they do not confirm arrival or a purchase.</Text></View>
              <View style={card}><Text style={typeStyle(tokens, 'sectionTitle')}>Platform measurement</Text>{report.platforms.map(p => <View key={p.platform} style={{ gap: tokens.space.xs }}><Text style={typeStyle(tokens, 'tileTitle')}>{p.platform}</Text><Text style={typeStyle(tokens, 'tileMeta')}>{value(p.values.product_opens)} product opens · {value(p.values.merchant_requests)} merchant requests</Text></View>)}<Text style={typeStyle(tokens, 'tileMeta')}>Platform is supplied by the client; it is not a verified device count.</Text></View>
              <View style={card}><Text style={typeStyle(tokens, 'sectionTitle')}>Opted-in account activity</Text>{row('Last 24 hours', value(report.activity.active24h))}{row('Last 7 days', value(report.activity.active7d))}<Text style={typeStyle(tokens, 'tileMeta')}>Distinct retained accounts with optional activity sharing, using server receipt time. {report.activity.covered24h && report.activity.covered7d ? 'Continuous sampled worker coverage.' : 'Partial sampled coverage.'} This is a consenting subset, not population DAU/WAU. Anonymous sessions are excluded.</Text></View>
              <View style={card}><Text style={typeStyle(tokens, 'sectionTitle')}>Business records</Text><Text style={typeStyle(tokens, 'tileMeta')}>Current database records as of {new Date(report.generatedAt).toLocaleString()}. Range counts use creation/publish timestamps on records still present; they are not historical transition counts.</Text>{Object.entries(SNAPSHOT_LABELS).map(([name, label]) => row(label, value(report.snapshot[name as keyof typeof SNAPSHOT_LABELS]), name))}</View>
              <View style={card}><Text style={typeStyle(tokens, 'sectionTitle')}>Ingestion & extraction</Text><Text style={typeStyle(tokens, 'tileMeta')}>Current status of sources/ingests created in this UTC range. Shared imports and global sources have different units. Retries can change these counts.</Text>
                <Text style={typeStyle(tokens, 'tileTitle')}>Content sources</Text>{report.sourceStatuses.length ? report.sourceStatuses.map(s => row(s.status, value(s.value), `source:${s.status}`)) : <Text style={typeStyle(tokens, 'bodyMuted')}>No source records in this cohort.</Text>}
                {row('Failed among READY + FAILED sources', value(report.terminalSourceFailurePercent, '%'))}{row('Ready with product candidates', value(report.extraction.ready_with_products))}{row('Ready without product candidates', value(report.extraction.ready_without_products))}{row('Product candidates', value(report.extraction.product_candidates))}{row('Candidates bound to product records', value(report.productBindingPercent, '%'))}{row('Place candidates', value(report.extraction.place_candidates))}{row('Resolved place candidates', value(report.placeResolutionPercent, '%'))}
                <Text style={typeStyle(tokens, 'tileMeta')}>Binding/resolution coverage is not extraction accuracy. In-flight sources are excluded from the terminal failure denominator.</Text><Text style={typeStyle(tokens, 'tileTitle')}>Creator ingests</Text>{report.ingestStatuses.length ? report.ingestStatuses.map(s => row(s.status, value(s.value), `ingest:${s.status}`)) : <Text style={typeStyle(tokens, 'bodyMuted')}>No creator ingest records in this cohort.</Text>}</View>
              <View style={card}><Text style={typeStyle(tokens, 'sectionTitle')}>Measurement health</Text>{report.health.map(h => row(HEALTH_LABELS[h.metric], `${value(h.value)} ${h.unit}`, h.metric))}<Text style={typeStyle(tokens, 'tileMeta')}>SQL event outcomes and best-effort buffered diagnostics have different units. These do not establish an end-to-end delivery/error rate.</Text>
                {report.reconciliation ? <><Text style={typeStyle(tokens, 'tileMeta')}>Counter reconciliation · {new Date(report.reconciliation.checked_at).toLocaleString()}</Text>{row('Collection counter mismatches', value(report.reconciliation.collection_mismatches))}{row('User counter mismatches', value(report.reconciliation.user_mismatches))}</> : <Text style={typeStyle(tokens, 'bodyMuted')}>No retained counter reconciliation report.</Text>}</View>
              <View style={card}><Text style={typeStyle(tokens, 'sectionTitle')}>Unavailable measurements</Text>{report.unavailable.map(item => <View key={item.metric} style={{ gap: tokens.space.xs }}><Text style={typeStyle(tokens, 'tileTitle')}>{item.metric}</Text><Text style={typeStyle(tokens, 'bodyMuted')}>{item.reason}</Text></View>)}</View>
            </> : null}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, paddingVertical: 4 } });
