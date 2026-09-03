import React from 'react';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FollowControl } from '@/components/engagement/FollowControl';
import { useThemeMode } from '@/contexts/ThemeContext';
import { creatorPath } from '@/src/services/sharePaths';
import { IMMERSIVE_TOKENS } from '@/src/theme/tokens';
import type { FeedReelFollow } from '@/src/ui/feedReelTypes';

const AVATAR_SIZE = 28;
/** Keeps the title clear of the floating action rail. */
const ACTION_RAIL_CLEARANCE = 72;
/** Text rhythm between the identity row and the reel title (below space.xxs). */
const IDENTITY_TITLE_GAP = 6;

type Props = {
  displayName: string;
  username?: string | null;
  avatarUrl?: string | null;
  title: string;
  follow?: FeedReelFollow | null;
};

export function FeedCreatorBlock({
  displayName,
  username,
  avatarUrl,
  title,
  follow,
}: Props) {
  const router = useRouter();
  const { tokens } = useThemeMode();
  const avatarStyle = [
    styles.avatar,
    { borderRadius: tokens.radius.pill, borderWidth: tokens.stroke.hairline },
  ];
  const nameStyle = [
    styles.creator,
    {
      color: tokens.immersive.text,
      fontSize: tokens.fontSize.bodyStrong,
      fontWeight: tokens.fontWeight.bold,
    },
  ];

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={[styles.identityRow, { gap: tokens.space.xs }]} pointerEvents="box-none">
        {username ? (
          <Pressable
            onPress={() => router.push(creatorPath(username) as Href)}
            accessibilityRole="link"
            accessibilityLabel={`View ${displayName} profile`}
            style={[styles.identityPress, { gap: tokens.space.xs }]}
          >
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={avatarStyle} contentFit="cover" />
            ) : (
              <View
                style={[
                  avatarStyle,
                  styles.avatarFallback,
                  { backgroundColor: tokens.immersive.surfaceSubtle },
                ]}
              />
            )}
            <Text style={nameStyle} numberOfLines={1}>
              {displayName}
            </Text>
          </Pressable>
        ) : (
          <View style={[styles.identityPress, { gap: tokens.space.xs }]}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={avatarStyle} contentFit="cover" />
            ) : null}
            <Text style={nameStyle} numberOfLines={1}>
              {displayName}
            </Text>
          </View>
        )}
        {follow ? (
          <FollowControl
            size="compact"
            immersive
            isFollowing={follow.isFollowing}
            pending={follow.pending}
            onPress={follow.onPress}
          />
        ) : null}
      </View>
      <Text
        style={[
          styles.title,
          {
            color: tokens.immersive.text,
            fontSize: tokens.fontSize.title,
            fontWeight: tokens.fontWeight.extraBold,
          },
        ]}
        numberOfLines={2}
      >
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: IDENTITY_TITLE_GAP,
    paddingRight: ACTION_RAIL_CLEARANCE,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  identityPress: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    minWidth: 0,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderColor: IMMERSIVE_TOKENS.ring,
  },
  avatarFallback: {
    borderWidth: 0,
  },
  creator: {
    flexShrink: 1,
    textShadowColor: IMMERSIVE_TOKENS.textShadow,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  title: {
    lineHeight: 22,
    textShadowColor: IMMERSIVE_TOKENS.textShadow,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
