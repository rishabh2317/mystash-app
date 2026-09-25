import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ExpandableText } from '@/components/ui/ExpandableText';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import type { CreatorViewModel } from '@/src/types/creator';

const AVATAR_SIZE = 72;

type Props = {
  creator: CreatorViewModel;
  /** Edit profile, Follow+Share row, or other identity action. */
  action?: React.ReactNode;
  /** When false, hide @handle (e.g. public profile — handle lives in TopBar). */
  showHandle?: boolean;
  /**
   * Instagram-style layout: avatar | (name above stats), then bio / action below.
   * When omitted, keeps the legacy personal layout (avatar | copy column).
   */
  statsSlot?: React.ReactNode;
};

/**
 * Shared creator identity for public storefront and personal You.
 */
export function ProfileIdentityHeader({
  creator,
  action,
  showHandle = true,
  statsSlot,
}: Props) {
  const { tokens } = useThemeMode();
  const name = creator.displayName?.trim() || `@${creator.username}`;
  const bio = creator.bio?.trim() ?? '';

  const avatar = creator.avatarUrl ? (
    <Image source={{ uri: creator.avatarUrl }} style={styles.avatar} contentFit="cover" />
  ) : (
    <View
      style={[
        styles.avatar,
        styles.avatarFallback,
        {
          backgroundColor: tokens.color.surfaceSubtle,
          borderColor: tokens.color.border,
          borderWidth: StyleSheet.hairlineWidth,
        },
      ]}
      accessibilityLabel="Default profile picture"
    >
      <Ionicons name="person-outline" size={28} color={tokens.color.textMuted} />
    </View>
  );

  if (statsSlot) {
    return (
      <View style={{ gap: tokens.space.md }}>
        <View style={[styles.heroRow, { gap: tokens.space.md }]}>
          {avatar}
          <View style={[styles.statsFlex, { gap: 6 }]}>
            <Text style={[typeStyle(tokens, 'tileTitle'), styles.nameAlign]} numberOfLines={2}>
              {name}
            </Text>
            {showHandle ? (
              <Text style={[typeStyle(tokens, 'tileMeta'), styles.nameAlign]} numberOfLines={1}>
                @{creator.username}
              </Text>
            ) : null}
            {statsSlot}
          </View>
        </View>
        {bio ? (
          <ExpandableText
            text={bio}
            collapsedLines={3}
            style={typeStyle(tokens, 'bodyMuted')}
          />
        ) : null}
        {action ? <View style={styles.actionRow}>{action}</View> : null}
      </View>
    );
  }

  return (
    <View style={[styles.identity, { gap: tokens.space.md }]}>
      {avatar}
      <View style={[styles.copy, { gap: tokens.space.xs }]}>
        <Text style={typeStyle(tokens, 'tileTitle')} numberOfLines={2}>
          {name}
        </Text>
        {showHandle ? (
          <Text style={typeStyle(tokens, 'tileMeta')} numberOfLines={1}>
            @{creator.username}
          </Text>
        ) : null}
        {action ? <View style={styles.action}>{action}</View> : null}
        {bio ? (
          <ExpandableText
            text={bio}
            collapsedLines={3}
            style={typeStyle(tokens, 'bodyMuted')}
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
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statsFlex: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  nameAlign: {
    textAlign: 'left',
    alignSelf: 'stretch',
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
    marginTop: 2,
  },
  actionRow: {
    width: '100%',
  },
});
