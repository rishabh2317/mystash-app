import React from 'react';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CreatorViewModel } from '@/src/types/creator';
import { useThemeMode } from '@/contexts/ThemeContext';

type Props = {
  creator: CreatorViewModel;
  /** @deprecated Colors come from ThemeMode tokens. */
  isLight?: boolean;
  onPress: (creator: CreatorViewModel) => void;
};

export function CreatorCard({ creator, onPress }: Props) {
  const { tokens } = useThemeMode();
  const name = creator.displayName?.trim() || `@${creator.username}`;
  return (
    <Pressable
      onPress={() => onPress(creator)}
      accessibilityRole="button"
      accessibilityLabel={`${name}, @${creator.username}`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: tokens.color.surface,
          borderColor: tokens.color.border,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      {creator.avatarUrl ? (
        <Image source={{ uri: creator.avatarUrl }} style={styles.avatar} contentFit="cover" />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: tokens.color.canvasEnd }]}>
          <Text style={{ color: tokens.color.text, fontWeight: '700' }}>
            {(name[0] ?? '?').toUpperCase()}
          </Text>
        </View>
      )}
      <View style={styles.body}>
        <Text style={[styles.name, { color: tokens.color.text }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.handle, { color: tokens.color.textMuted }]} numberOfLines={1}>
          @{creator.username}
        </Text>
        <Text style={[styles.stats, { color: tokens.color.textMuted }]}>
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
