import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { TopBar } from '@/components/chrome/TopBar';
import { ProfileRow } from '@/components/profile/ProfileRow';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { getMyCreatorAnalytics, type CreatorAnalyticsSummary } from '@/src/services/engagementApi';
import { ensureMe } from '@/src/services/userApi';

export default function AnalyticsScreen() {
  const { tokens, isLight } = useThemeMode();
  const { user, loading } = useAuth();
  const [analytics, setAnalytics] = useState<CreatorAnalyticsSummary | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [allowed, setAllowed] = useState(true);

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
        return getMyCreatorAnalytics().then((next) => {
          if (!cancelled) setAnalytics(next);
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

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={
          isLight
            ? [tokens.color.canvasSoft, tokens.color.canvasSoftEnd, tokens.color.canvasEnd]
            : [tokens.color.canvasSoft, tokens.color.canvasSoftEnd, tokens.color.canvas]
        }
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <TopBar mode="page" title="Analytics" showBack />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!user && !loading ? (
          <Text style={[styles.empty, { color: tokens.color.textMuted }]}>
            Sign in to view analytics.
          </Text>
        ) : !allowed ? (
          <Text style={[styles.empty, { color: tokens.color.textMuted }]}>
            Analytics are available after you start creating.
          </Text>
        ) : analyticsLoading && !analytics ? (
          <ActivityIndicator color={tokens.color.accent} />
        ) : analytics ? (
          <>
            <ProfileRow icon="eye-outline" label="Collection views" value={String(analytics.totals.views)} />
            <ProfileRow icon="people-outline" label="Followers" value={String(analytics.totals.followers)} />
            <ProfileRow icon="bookmark-outline" label="Collection saves" value={String(analytics.totals.saves)} />
            <ProfileRow icon="share-outline" label="Collection shares" value={String(analytics.totals.shares)} />
            <ProfileRow
              icon="storefront-outline"
              label="Shopping redirects"
              value={String(analytics.totals.productRedirects)}
            />
            {analytics.collections.slice(0, 5).map((c) => (
              <ProfileRow
                key={c.collectionId}
                icon="albums-outline"
                label={c.title?.trim() || 'Collection'}
                value={`${c.views} views · ${c.saves} saves · ${c.shares} shares · ${c.productRedirects} redirects`}
              />
            ))}
          </>
        ) : (
          <Text style={[styles.empty, { color: tokens.color.textMuted }]}>
            Analytics unavailable right now.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 32,
    gap: 10,
  },
  empty: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
  },
});
