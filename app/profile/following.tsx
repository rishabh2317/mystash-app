import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { TopBar } from '@/components/chrome/TopBar';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { listFollowingIds } from '@/src/services/engagementApi';
import { PERSONAL_PROFILE_COPY } from '@/src/ui/personalProfile';

export default function PersonalFollowingScreen() {
  const { tokens } = useThemeMode();
  const { user } = useAuth();
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void listFollowingIds()
      .then((ids) => {
        if (!cancelled) setCount(ids.length);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : PERSONAL_PROFILE_COPY.emptyFollowing);
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
      <TopBar mode="page" title={PERSONAL_PROFILE_COPY.followingLabel} showBack showBag={false} />
      <View style={styles.body}>
        {loading ? (
          <ActivityIndicator color={tokens.color.text} />
        ) : error ? (
          <Text style={{ color: tokens.color.textMuted, textAlign: 'center' }}>{error}</Text>
        ) : count === 0 ? (
          <Text style={{ color: tokens.color.textMuted, textAlign: 'center' }}>
            {PERSONAL_PROFILE_COPY.emptyFollowing}
          </Text>
        ) : (
          <Text style={{ color: tokens.color.textMuted, textAlign: 'center', lineHeight: 22 }}>
            {`You're following ${count} ${count === 1 ? 'person' : 'people'}.\n${PERSONAL_PROFILE_COPY.followingUnavailable}`}
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
