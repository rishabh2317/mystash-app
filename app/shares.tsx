import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { TopBar } from '@/components/chrome/TopBar';
import { ShareActivityCard } from '@/components/search/ShareActivityCard';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { useImportSharesPoll } from '@/src/hooks/useImportSharesPoll';
import { deleteUserImport, retryUserImport } from '@/src/services/userImportApi';
import { pageCanvasGradient } from '@/src/theme/tokens';
import { SHARE_ACTIVITY_COPY, shareActivityHistoryItems } from '@/src/ui/shareActivity';

export default function YourSharesScreen() {
  const router = useRouter();
  const { tokens } = useThemeMode();
  const { user, loading: authLoading } = useAuth();
  const { shares, loaded, refresh } = useImportSharesPoll({ enabled: Boolean(user) });
  const items = useMemo(() => shareActivityHistoryItems(shares), [shares]);

  const onRetry = useCallback(
    async (importId: string) => {
      await retryUserImport(importId);
      await refresh();
    },
    [refresh],
  );

  const onDelete = useCallback(
    async (importId: string) => {
      await deleteUserImport(importId);
      await refresh();
    },
    [refresh],
  );

  const bg = pageCanvasGradient(tokens);

  let body: React.ReactNode;
  if (authLoading || (user && !loaded)) {
    body = (
      <View style={styles.center}>
        <ActivityIndicator color={tokens.color.accent} />
      </View>
    );
  } else if (!user) {
    body = (
      <View style={styles.center}>
        <Text style={[styles.emptyTitle, { color: tokens.color.text }]}>Sign in to see shares</Text>
        <Text style={[styles.emptySub, { color: tokens.color.textMuted }]}>
          Links you paste or share will show up here.
        </Text>
        <Pressable
          style={[styles.cta, { backgroundColor: tokens.color.cta }]}
          onPress={() => router.push('/(tabs)/profile')}
        >
          <Text style={styles.ctaText}>Sign in</Text>
        </Pressable>
      </View>
    );
  } else if (items.length === 0) {
    body = (
      <View style={styles.center}>
        <Text style={[styles.emptyTitle, { color: tokens.color.text }]}>No shares yet</Text>
        <Text style={[styles.emptySub, { color: tokens.color.textMuted }]}>
          Paste a product, Reel, or Short URL from Search to get started.
        </Text>
        <Pressable
          style={[styles.cta, { backgroundColor: tokens.color.cta }]}
          onPress={() => router.replace('/(tabs)/search')}
        >
          <Text style={styles.ctaText}>Go to Search</Text>
        </Pressable>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={items}
        keyExtractor={(item) => item.importId}
        contentContainerStyle={styles.list}
        refreshing={false}
        onRefresh={() => void refresh()}
        renderItem={({ item }) => (
          <ShareActivityCard
            item={item}
            expandable
            onRetry={onRetry}
            onDelete={onDelete}
          />
        )}
      />
    );
  }

  return (
    <View style={styles.root}>
      <LinearGradient colors={[...bg]} style={StyleSheet.absoluteFill} />
      <TopBar mode="page" title={SHARE_ACTIVITY_COPY.sharesTitle} showBack />
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { padding: 16, paddingBottom: 40, gap: 10 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  emptySub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  cta: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  ctaText: { color: '#fff', fontWeight: '800' },
});
