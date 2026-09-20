import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ExpandableText } from '@/components/ui/ExpandableText';
import { useThemeMode } from '@/contexts/ThemeContext';
import type { CreatorViewModel } from '@/src/types/creator';

const AVATAR_SIZE = 88;

type Props = {
  creator: CreatorViewModel;
  /** Edit profile, Follow, or other identity action — sits under the handle. */
  action?: React.ReactNode;
};

/**
 * Shared creator identity for public storefront and personal You.
 * Large avatar + name + handle + optional bio; the action is owned by the parent.
 */
export function ProfileIdentityHeader({ creator, action }: Props) {
  const { tokens } = useThemeMode();
  const name = creator.displayName?.trim() || `@${creator.username}`;
  const bio = creator.bio?.trim() ?? '';

  return (
    <View style={[styles.identity, { gap: tokens.space.md }]}>
      {creator.avatarUrl ? (
        <Image
          source={{ uri: creator.avatarUrl }}
          style={styles.avatar}
          contentFit="cover"
        />
      ) : (
        <View
          style={[
            styles.avatar,
            styles.avatarFallback,
            { backgroundColor: tokens.color.surfaceSubtle },
          ]}
          accessibilityLabel="Default profile picture"
        >
          <Ionicons name="person" size={32} color={tokens.color.textMuted} />
        </View>
      )}
      <View style={[styles.copy, { gap: tokens.space.xs }]}>
        <Text
          style={{
            color: tokens.color.text,
            fontSize: tokens.fontSize.title,
            lineHeight: tokens.lineHeight.title,
            fontWeight: tokens.fontWeight.bold,
          }}
          numberOfLines={2}
        >
          {name}
        </Text>
        <Text
          style={{
            color: tokens.color.textMuted,
            fontSize: tokens.fontSize.label,
            lineHeight: tokens.lineHeight.label,
          }}
          numberOfLines={1}
        >
          @{creator.username}
        </Text>
        {action ? <View style={styles.action}>{action}</View> : null}
        {bio ? (
          <ExpandableText
            text={bio}
            collapsedLines={3}
            style={{
              color: tokens.color.textMuted,
              fontSize: tokens.fontSize.caption,
              lineHeight: tokens.lineHeight.caption,
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  identity: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  action: {
    alignSelf: 'flex-start',
  },
});
