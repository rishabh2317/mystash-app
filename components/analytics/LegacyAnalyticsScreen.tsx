import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { TopBar } from '@/components/chrome/TopBar';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { listCreatorCollections } from '@/src/services/collectionApi';
import {
  getMyCreatorAnalytics,
  type CreatorAnalyticsSummary,
} from '@/src/services/engagementApi';
import { ensureMe } from '@/src/services/userApi';
import { outlineCardChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import {
  ANALYTICS_COPY,
  analyticsTotalsAreEmpty,
  collectionAnalyticsLine,
  formatAnalyticsCount,
  rankAnalyticsCollections,
} from '@/src/ui/creatorAnalytics';
import { collectionTilePressPath } from '@/src/ui/collectionLayout';

export default function AnalyticsScreen() {
  const router = useRouter();
  const { tokens } = useThemeMode();
  const { user, loading } = useAuth();
  const [analytics, setAnalytics] = useState<CreatorAnalyticsSummary | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [allowed, setAllowed] = useState(true);
  const chrome = outlineCardChrome(tokens);

  useEffect(() => {
    if (!user || loading) {
      setAnalytics(null);
      setAllowed(false);
      return;
    }
    let cancelled = false;
    setAnalyticsLoading(true);
    ensureMe()
      .then((me) => {
        if (cancelled) return;
        if (me.creatorStatus === 'NONE') {
          setAllowed(false);
          setAnalytics(null);
          return;
        }
        setAllowed(true);
        return Promise.all([
          getMyCreatorAnalytics(),
          listCreatorCollections(me.userId, { limit: 20 }).catch(() => ({ collections: [] })),
        ]).then(([next, page]) => {
          if (cancelled) return;
          setAnalytics(next);
          const map: Record<string, string | null> = {};
          for (const c of page.collections) {
            map[c.collectionId] = c.heroThumbnailUrl;
          }
          setThumbs(map);
        });
      })
      .catch(() => {
        if (!cancelled) {
          setAllowed(true);
          setAnalytics(null);
        }
      })
      .finally(() => {
        if (!cancelled) setAnalyticsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  const ranked = useMemo(
    () => (analytics ? rankAnalyticsCollections(analytics.collections).slice(0, 5) : []),
    [analytics],
  );
  const empty = analytics ? analyticsTotalsAreEmpty(analytics.totals) : false;

  return (
    <View style={[styles.screen, { backgroundColor: tokens.color.canvas }]}>
      <TopBar mode="page" title={ANALYTICS_COPY.title} showBack />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: tokens.space.lg,
          paddingTop: tokens.space.sm,
          paddingBottom: tokens.space.xxl,
          gap: tokens.space.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        {!user && !loading ? (
          <Text style={typeStyle(tokens, 'bodyMuted')}>{ANALYTICS_COPY.signIn}</Text>
        ) : !allowed ? (
          <Text style={typeStyle(tokens, 'bodyMuted')}>{ANALYTICS_COPY.notCreator}</Text>
        ) : analyticsLoading && !analytics ? (
          <ActivityIndicator color={tokens.color.primary} />
        ) : analytics && empty ? (
          <View style={{ gap: tokens.space.sm, paddingTop: tokens.space.lg }}>
            <Text style={typeStyle(tokens, 'identityTitle')}>{ANALYTICS_COPY.emptyTitle}</Text>
            <Text style={typeStyle(tokens, 'bodyMuted')}>{ANALYTICS_COPY.emptyBody}</Text>
          </View>
        ) : analytics ? (
          <>
            <View style={{ gap: tokens.space.xs }}>
              <Text style={typeStyle(tokens, 'tileMeta')}>{ANALYTICS_COPY.lifetime}</Text>
              <Text style={typeStyle(tokens, 'identityTitle')}>
                {formatAnalyticsCount(analytics.totals.views)}
              </Text>
              <Text style={typeStyle(tokens, 'bodyMuted')}>{ANALYTICS_COPY.headlineViews}</Text>
              <Text style={typeStyle(tokens, 'tileMeta')}>{ANALYTICS_COPY.definitionHint}</Text>
            </View>

            <View style={{ flexDirection: 'row', gap: tokens.space.md }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={typeStyle(tokens, 'tileTitle')}>
                  {formatAnalyticsCount(analytics.totals.followers)}
                </Text>
                <Text style={typeStyle(tokens, 'tileMeta')}>{ANALYTICS_COPY.followers}</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={typeStyle(tokens, 'tileTitle')}>
                  {formatAnalyticsCount(analytics.totals.saves)}
                </Text>
                <Text style={typeStyle(tokens, 'tileMeta')}>{ANALYTICS_COPY.saves}</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={typeStyle(tokens, 'tileTitle')}>
                  {formatAnalyticsCount(analytics.totals.productRedirects)}
                </Text>
                <Text style={typeStyle(tokens, 'tileMeta')}>{ANALYTICS_COPY.productClicks}</Text>
              </View>
            </View>

            {ranked.length > 0 ? (
              <View style={{ gap: tokens.space.sm }}>
                <Text style={typeStyle(tokens, 'sectionTitle')}>{ANALYTICS_COPY.topCollections}</Text>
                {ranked.map((c) => {
                  const thumb = thumbs[c.collectionId];
                  return (
                    <Pressable
                      key={c.collectionId}
                      onPress={() => router.push(collectionTilePressPath(c.collectionId))}
                      accessibilityRole="button"
                      style={[
                        styles.row,
                        chrome,
                        {
                          borderWidth: StyleSheet.hairlineWidth,
                          borderRadius: tokens.radius.md,
                          padding: tokens.space.sm,
                          gap: tokens.space.sm,
                        },
                      ]}
                    >
                      {thumb ? (
                        <Image source={{ uri: thumb }} style={styles.thumb} contentFit="cover" />
                      ) : (
                        <View style={[styles.thumb, { backgroundColor: tokens.color.canvasEnd }]} />
                      )}
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={typeStyle(tokens, 'tileTitle')} numberOfLines={1}>
                          {c.title?.trim() || 'Collection'}
                        </Text>
                        <Text style={typeStyle(tokens, 'tileMeta')} numberOfLines={2}>
                          {collectionAnalyticsLine(c)}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </>
        ) : (
          <Text style={typeStyle(tokens, 'bodyMuted')}>{ANALYTICS_COPY.unavailable}</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  thumb: { width: 56, height: 72, borderRadius: 8 },
});
