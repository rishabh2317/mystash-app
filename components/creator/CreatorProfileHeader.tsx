import React from 'react';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CreatorViewModel } from '@/src/types/creator';
import { FollowControl } from '@/components/engagement/FollowControl';
import { useThemeMode } from '@/contexts/ThemeContext';

export type CreatorProfileTab = 'collections' | 'products';

type Props = {
  creator: CreatorViewModel;
  isLight: boolean;
  isSelf: boolean;
  followPending?: boolean;
  activeTab: CreatorProfileTab;
  onFollowPress: () => void;
  onTabChange: (tab: CreatorProfileTab) => void;
};

function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.floor(n));
}

function Metric({
  value,
  label,
  accessibilityLabel,
}: {
  value: number;
  label: string;
  accessibilityLabel: string;
}) {
  const { tokens } = useThemeMode();
  return (
    <View style={styles.metric} accessibilityRole="text" accessibilityLabel={accessibilityLabel}>
      <Text style={[styles.metricValue, { color: tokens.color.text }]}>{formatCount(value)}</Text>
      <Text style={[styles.metricLabel, { color: tokens.color.textMuted }]}>{label}</Text>
    </View>
  );
}

export function CreatorProfileHeader({
  creator,
  isLight,
  isSelf,
  followPending,
  activeTab,
  onFollowPress,
  onTabChange,
}: Props) {
  const { tokens } = useThemeMode();
  const name = creator.displayName?.trim() || `@${creator.username}`;
  const text = tokens.color.text;
  const muted = tokens.color.textMuted;
  const collectionsLabel = creator.collectionCount === 1 ? 'Collection' : 'Collections';
  const followersLabel = creator.followersCount === 1 ? 'Follower' : 'Followers';
  const savesLabel = creator.savesCount === 1 ? 'Save' : 'Saves';

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {creator.avatarUrl ? (
          <Image source={{ uri: creator.avatarUrl }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View
            style={[
              styles.avatar,
              styles.avatarFallback,
              { backgroundColor: tokens.color.canvasEnd },
            ]}
          >
            <Text style={{ color: text, fontSize: 28, fontWeight: '700' }}>
              {(name[0] ?? '?').toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.meta}>
          <Text style={[styles.name, { color: text }]} numberOfLines={2}>
            {name}
          </Text>
          <Text style={[styles.handle, { color: muted }]}>@{creator.username}</Text>
        </View>
      </View>

      <View style={styles.metricsRow}>
        <Metric
          value={creator.collectionCount}
          label={collectionsLabel}
          accessibilityLabel={`${creator.collectionCount} ${collectionsLabel.toLowerCase()}`}
        />
        <Metric
          value={creator.followersCount}
          label={followersLabel}
          accessibilityLabel={`${creator.followersCount} ${followersLabel.toLowerCase()}`}
        />
        <Metric
          value={creator.savesCount}
          label={savesLabel}
          accessibilityLabel={`${creator.savesCount} ${savesLabel.toLowerCase()} across collections`}
        />
      </View>

      {creator.bio ? (
        <Text style={[styles.bio, { color: muted }]}>{creator.bio}</Text>
      ) : null}

      <View style={styles.actions}>
        {isSelf ? (
          <FollowControl
            isFollowing
            isLight={isLight}
            disabled
            labelOverride="You"
            onPress={() => {}}
          />
        ) : (
          <FollowControl
            isFollowing={Boolean(creator.isFollowing)}
            pending={followPending}
            isLight={isLight}
            onPress={onFollowPress}
          />
        )}
      </View>

      <View
        style={[
          styles.tabs,
          {
            borderBottomColor: tokens.color.border,
            gap: tokens.space.lg,
          },
        ]}
        accessibilityRole="tablist"
      >
        {(['collections', 'products'] as const).map((tab) => {
          const selected = activeTab === tab;
          const label = tab === 'collections' ? 'Collections' : 'Products';
          return (
            <Pressable
              key={tab}
              onPress={() => onTabChange(tab)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={label}
              style={[
                styles.tab,
                selected && {
                  borderBottomColor: tokens.color.text,
                  borderBottomWidth: 2,
                },
              ]}
            >
              <Text
                style={{
                  color: selected ? text : muted,
                  fontSize: tokens.fontSize.bodyStrong,
                  fontWeight: selected ? tokens.fontWeight.bold : tokens.fontWeight.semibold,
                }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 0 },
  row: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  meta: { flex: 1, gap: 4 },
  name: { fontSize: 22, fontWeight: '800' },
  handle: { fontSize: 14 },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 4,
  },
  metric: { alignItems: 'center', minWidth: 72, gap: 2 },
  metricValue: { fontSize: 18, fontWeight: '800' },
  metricLabel: { fontSize: 12, fontWeight: '600' },
  bio: { fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row' },
  tabs: {
    flexDirection: 'row',
    marginTop: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    paddingVertical: 12,
    paddingHorizontal: 4,
    minHeight: 44,
    justifyContent: 'center',
  },
});
