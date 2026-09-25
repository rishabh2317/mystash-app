import React, { useState } from 'react';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
} from 'react-native';

import { FollowControl } from '@/components/engagement/FollowControl';
import { ContentPlayChip } from '@/components/ui/ContentPlayChip';
import { useThemeMode } from '@/contexts/ThemeContext';
import { creatorPath } from '@/src/services/sharePaths';
import { IMMERSIVE_TOKENS } from '@/src/theme/tokens';
import type { CreatorMoreReelTarget } from '@/src/ui/collectionCreatorMore';
import { collectionTilePressPath } from '@/src/ui/collectionLayout';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
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
  /** Another published Collection from this creator. Hidden when null. */
  moreFromCreator?: CreatorMoreReelTarget | null;
};

/** One-line caption with inline “view more” when the copy overflows. */
function FeedCaption({ text }: { text: string }) {
  const { tokens } = useThemeMode();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  const captionStyle = {
    color: tokens.immersive.textMuted,
    fontSize: tokens.fontSize.caption,
    lineHeight: tokens.lineHeight.caption,
    fontFamily: tokens.fontFamily.medium,
    fontWeight: tokens.fontWeight.regular,
    textShadowColor: IMMERSIVE_TOKENS.textShadow,
    textShadowOffset: { width: 0, height: 1 } as const,
    textShadowRadius: 3,
  };
  const moreStyle = {
    color: tokens.immersive.text,
    fontSize: tokens.fontSize.caption,
    lineHeight: tokens.lineHeight.caption,
    fontFamily: tokens.fontFamily.semibold,
    fontWeight: tokens.fontWeight.semibold,
  };

  const onMeasure = (event: NativeSyntheticEvent<TextLayoutEventData>) => {
    const lines = event.nativeEvent.lines.length;
    setOverflows((current) => {
      const next = lines > 1;
      return current === next ? current : next;
    });
  };

  if (expanded) {
    return (
      <Pressable
        onPress={() => setExpanded(false)}
        accessibilityRole="button"
        accessibilityLabel={`${text}. Less`}
        accessibilityState={{ expanded: true }}
        style={({ pressed }) => ({
          opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
        })}
      >
        <Text style={captionStyle}>
          {text}
          <Text style={moreStyle}>{` less`}</Text>
        </Text>
      </Pressable>
    );
  }

  return (
    <View>
      <Text
        style={[captionStyle, styles.measure]}
        onTextLayout={onMeasure}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {text}
      </Text>
      <Pressable
        onPress={() => {
          if (overflows) setExpanded(true);
        }}
        disabled={!overflows}
        accessibilityRole={overflows ? 'button' : 'text'}
        accessibilityLabel={overflows ? `${text}. View more` : text}
        accessibilityState={overflows ? { expanded: false } : undefined}
        style={({ pressed }) => [
          styles.captionRow,
          {
            opacity: controlOpacity(
              resolveControlPhase({ pressed: pressed && overflows }),
              tokens.motion.pressOpacity,
            ),
          },
        ]}
      >
        <Text style={[captionStyle, styles.captionClamp]} numberOfLines={1} ellipsizeMode="tail">
          {text}
        </Text>
        {overflows ? (
          <Text style={moreStyle} numberOfLines={1}>
            {' '}
            view more
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

export function FeedCreatorBlock({
  displayName,
  username,
  avatarUrl,
  title,
  follow,
  moreFromCreator,
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
      {title.trim() ? <FeedCaption text={title.trim()} /> : null}
      {moreFromCreator ? (
        <ContentPlayChip
          immersive
          label={moreFromCreator.title}
          onPress={() =>
            router.push(collectionTilePressPath(moreFromCreator.collectionId) as Href)
          }
        />
      ) : null}
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
  captionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  captionClamp: {
    flexShrink: 1,
    minWidth: 0,
  },
  measure: {
    position: 'absolute',
    opacity: 0,
    left: 0,
    right: 0,
    zIndex: -1,
  },
});
