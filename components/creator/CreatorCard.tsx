import React from 'react';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CreatorViewModel } from '@/src/types/creator';

type Props = {
  creator: CreatorViewModel;
  isLight: boolean;
  onPress: (creator: CreatorViewModel) => void;
};

export function CreatorCard({ creator, isLight, onPress }: Props) {
  const name = creator.displayName?.trim() || `@${creator.username}`;
  return (
    <Pressable
      onPress={() => onPress(creator)}
      accessibilityRole="button"
      accessibilityLabel={`${name}, @${creator.username}`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: isLight ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.06)',
          borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)',
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      {creator.avatarUrl ? (
        <Image source={{ uri: creator.avatarUrl }} style={styles.avatar} contentFit="cover" />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: isLight ? '#E5E7EB' : '#334155' }]}>
          <Text style={{ color: isLight ? '#1A1A1B' : '#F8FAFC', fontWeight: '700' }}>
            {(name[0] ?? '?').toUpperCase()}
          </Text>
        </View>
      )}
      <View style={styles.body}>
        <Text style={[styles.name, { color: isLight ? '#1A1A1B' : '#F8FAFC' }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.handle, { color: isLight ? '#6B7280' : '#94A3B8' }]} numberOfLines={1}>
          @{creator.username}
        </Text>
        <Text style={[styles.stats, { color: isLight ? '#4E5257' : '#AEB8C5' }]}>
          {creator.followersCount} followers · {creator.collectionCount} collections
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '700' },
  handle: { fontSize: 13 },
  stats: { fontSize: 12, marginTop: 2 },
});
