import { Image } from 'expo-image';
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { FollowControl } from '@/components/engagement/FollowControl';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { useCreatorFollowHandler } from '@/src/services/creatorFollowOrchestration';
import { outlineCardChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import type { DiscoverCreatorSuggestion } from '@/src/ui/discoverCreators';
import { formatEngagementCount } from '@/src/ui/formatEngagementCount';

type Props = {
  suggestion: DiscoverCreatorSuggestion;
  /** Compact = Profile rail; detail = See more page. */
  variant: 'compact' | 'detail';
  isSelf?: boolean;
  onPressCreator: (username: string) => void;
  onFollowChange?: (creatorId: string, isFollowing: boolean) => void;
};

/**
 * Shared Discover Creators card — compact rail tile or full See-more card.
 * Follow uses existing `useCreatorFollowHandler`; media/social proof only when real.
 */
export function DiscoverCreatorSuggestionCard({
  suggestion,
  variant,
  isSelf = false,
  onPressCreator,
  onFollowChange,
}: Props) {
  const { tokens, isLight } = useThemeMode();
  const { creator, previewUrls, followedByLabel } = suggestion;
  const handle = creator.username.replace(/^@/, '');
  const name = creator.displayName?.trim() || `@${handle}`;
  const [isFollowing, setIsFollowing] = useState(Boolean(creator.isFollowing));
  const [followPending, setFollowPending] = useState(false);

  const followHandler = useCreatorFollowHandler({
    creatorId: creator.userId,
    username: handle,
    isSelf,
    isFollowing,
    onOptimisticFollow: (next) => {
      setFollowPending(true);
      setIsFollowing(next);
      onFollowChange?.(creator.userId, next);
    },
    onRollback: (previous) => {
      setIsFollowing(previous);
      setFollowPending(false);
      onFollowChange?.(creator.userId, previous);
    },
  });

  const onFollowPress = useCallback(async () => {
    try {
      await followHandler();
    } finally {
      setFollowPending(false);
    }
  }, [followHandler]);

  const avatar = creator.avatarUrl ? (
    <Image source={{ uri: creator.avatarUrl }} style={styles.avatar} contentFit="cover" />
  ) : (
    <View
      style={[
        styles.avatar,
        styles.avatarFallback,
        { backgroundColor: tokens.color.surfaceSubtle, borderColor: tokens.color.border },
      ]}
    >
      <Text style={[typeStyle(tokens, 'tileTitle'), { color: tokens.color.textMuted }]}>
        {(name[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );

  if (variant === 'compact') {
    return (
      <Pressable
        onPress={() => onPressCreator(handle)}
        accessibilityRole="button"
        accessibilityLabel={`${name}, @${handle}`}
        style={({ pressed }) => [
          styles.compactCard,
          {
            ...outlineCardChrome(tokens),
            borderRadius: tokens.radius.md,
            opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
          },
        ]}
      >
        {avatar}
        <Text style={typeStyle(tokens, 'tileTitle')} numberOfLines={1}>
          {handle}
        </Text>
        {followedByLabel ? (
          <Text style={typeStyle(tokens, 'tileMeta')} numberOfLines={2}>
            {followedByLabel}
          </Text>
        ) : (
          <Text style={typeStyle(tokens, 'tileMeta')} numberOfLines={1}>
            {formatEngagementCount(creator.followersCount)} followers
          </Text>
        )}
        {!isSelf ? (
          <View style={styles.compactFollow}>
            <FollowControl
              isFollowing={isFollowing}
              pending={followPending}
              isLight={isLight}
              emphasis="brand"
              slim
              fullWidth
              onPress={() => void onFollowPress()}
            />
          </View>
        ) : null}
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => onPressCreator(handle)}
      accessibilityRole="button"
      accessibilityLabel={`${name}, @${handle}`}
      style={({ pressed }) => [
        styles.detailCard,
        {
          ...outlineCardChrome(tokens),
          borderRadius: tokens.radius.md,
          opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
        },
      ]}
    >
      <View style={[styles.detailHeader, { gap: tokens.space.sm }]}>
        {avatar}
        <View style={styles.detailIdentity}>
          <Text style={typeStyle(tokens, 'tileTitle')} numberOfLines={1}>
            {handle}
          </Text>
          <Text style={typeStyle(tokens, 'tileMeta')} numberOfLines={1}>
            {formatEngagementCount(creator.followersCount)} followers
          </Text>
        </View>
        {!isSelf ? (
          <FollowControl
            isFollowing={isFollowing}
            pending={followPending}
            isLight={isLight}
            emphasis="brand"
            slim
            onPress={() => void onFollowPress()}
          />
        ) : null}
      </View>

      {previewUrls.length > 0 ? (
        <View style={[styles.mediaRow, { gap: tokens.space.xxs }]}>
          {previewUrls.slice(0, 3).map((uri) => (
            <View
              key={uri}
              style={[
                styles.mediaCell,
                {
                  borderRadius: tokens.radius.sm,
                  backgroundColor: tokens.color.surfaceSubtle,
                },
              ]}
            >
              <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            </View>
          ))}
          {previewUrls.length < 3
            ? Array.from({ length: 3 - previewUrls.length }).map((_, i) => (
                <View
                  key={`empty-${i}`}
                  style={[
                    styles.mediaCell,
                    {
                      borderRadius: tokens.radius.sm,
                      backgroundColor: tokens.color.surfaceSubtle,
                    },
                  ]}
                />
              ))
            : null}
        </View>
      ) : null}

      {followedByLabel ? (
        <Text style={typeStyle(tokens, 'tileMeta')} numberOfLines={1}>
          {followedByLabel}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  compactCard: {
    width: 132,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingTop: 12,
    paddingBottom: 10,
    alignItems: 'center',
    gap: 6,
  },
  compactFollow: {
    width: '100%',
    marginTop: 2,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  detailCard: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 10,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailIdentity: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  mediaRow: {
    flexDirection: 'row',
  },
  mediaCell: {
    flex: 1,
    aspectRatio: 1,
    overflow: 'hidden',
  },
});
