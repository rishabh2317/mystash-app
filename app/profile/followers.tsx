import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { TopBar } from '@/components/chrome/TopBar';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { ensureMe } from '@/src/services/userApi';
import { formatEngagementCount } from '@/src/ui/formatEngagementCount';
import { PERSONAL_PROFILE_COPY } from '@/src/ui/personalProfile';

export default function PersonalFollowersScreen() {
  const { tokens } = useThemeMode();
  const { user } = useAuth();
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void ensureMe()
      .then((me) => {
        if (!cancelled) setCount(me.followersCount);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : PERSONAL_PROFILE_COPY.emptyFollowers);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <View style={[styles.screen, { backgroundColor: tokens.color.canvas }]}>
      <TopBar mode="page" title={PERSONAL_PROFILE_COPY.followersLabel} showBack showBag={false} />
      <View style={styles.body}>
        {loading ? (
          <ActivityIndicator color={tokens.color.text} />
        ) : error ? (
          <Text style={{ color: tokens.color.textMuted, textAlign: 'center' }}>{error}</Text>
        ) : count === 0 ? (
          <Text style={{ color: tokens.color.textMuted, textAlign: 'center' }}>
            {PERSONAL_PROFILE_COPY.emptyFollowers}
          </Text>
        ) : (
          <Text style={{ color: tokens.color.textMuted, textAlign: 'center', lineHeight: 22 }}>
            {`${formatEngagementCount(count ?? 0)} ${count === 1 ? 'follower' : 'followers'}.\n${PERSONAL_PROFILE_COPY.followersUnavailable}`}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
});
