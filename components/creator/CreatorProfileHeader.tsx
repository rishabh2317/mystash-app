import React from 'react';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import type { CreatorViewModel } from '@/src/types/creator';
import { FollowControl } from '@/components/engagement/FollowControl';
import { useThemeMode } from '@/contexts/ThemeContext';

type Props = {
  creator: CreatorViewModel;
  isLight: boolean;
  isSelf: boolean;
  followPending?: boolean;
  onFollowPress: () => void;
};

export function CreatorProfileHeader({
  creator,
  isLight,
  isSelf,
  followPending,
  onFollowPress,
}: Props) {
  const { tokens } = useThemeMode();
  const name = creator.displayName?.trim() || `@${creator.username}`;
  const text = tokens.color.text;
  const muted = tokens.color.textMuted;

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
          <View style={styles.statsRow}>
            <Text style={[styles.stat, { color: text }]}>
              <Text style={styles.statNum}>{creator.followersCount}</Text> followers
            </Text>
            <Text style={[styles.stat, { color: text }]}>
              <Text style={styles.statNum}>{creator.collectionCount}</Text> collections
            </Text>
          </View>
        </View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  row: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  meta: { flex: 1, gap: 4 },
  name: { fontSize: 22, fontWeight: '800' },
  handle: { fontSize: 14 },
  statsRow: { flexDirection: 'row', gap: 14, marginTop: 6 },
  stat: { fontSize: 13 },
  statNum: { fontWeight: '700' },
  bio: { fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row' },
});
