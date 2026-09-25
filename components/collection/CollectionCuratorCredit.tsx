import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { FollowControl } from '@/components/engagement/FollowControl';
import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { typeStyle } from '@/src/theme/typography';
import type { CollectionDetailViewModel } from '@/src/types/collectionDetail';
import { COLLECTION_SECTION_COPY } from '@/src/ui/collectionSections';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';

type Props = {
  collection: CollectionDetailViewModel;
  onCreatorPress?: () => void;
  isFollowing?: boolean;
  followPending?: boolean;
  onFollowPress?: () => void;
};

/** Matches “Curated by” + handle line stack (tileMeta + bodyMuted + 1px gap). */
const COPY_STACK_GAP = 1;

/**
 * Quiet curator attribution under the collection media tile.
 * Handle-only credit — micro Follow sits on the “Curated by” line.
 */
export function CollectionCuratorCredit({
  collection,
  onCreatorPress,
  isFollowing = false,
  followPending = false,
  onFollowPress,
}: Props) {
  const { tokens } = useThemeMode();
  const username = collection.creator.username?.trim() || null;
  const handle = username ? `@${username}` : null;
  const a11yLabel = handle
    ? `${COLLECTION_SECTION_COPY.curatedBy} ${handle}`
    : COLLECTION_SECTION_COPY.curatedBy;
  const avatarUrl = collection.creator.avatarUrl?.trim() || null;
  const [avatarFailed, setAvatarFailed] = useState(false);
  const showAvatar = Boolean(avatarUrl) && !avatarFailed;
  const avatarSize = tokens.lineHeight.caption + tokens.lineHeight.body + COPY_STACK_GAP;

  useEffect(() => {
    setAvatarFailed(false);
  }, [avatarUrl]);

  if (!handle) return null;

  return (
    <View
      style={[
        styles.row,
        {
          gap: tokens.space.xs,
          paddingTop: tokens.space.xxs,
        },
      ]}
    >
      <Pressable
        onPress={onCreatorPress}
        disabled={!onCreatorPress}
        accessibilityRole={onCreatorPress ? 'link' : 'text'}
        accessibilityLabel={a11yLabel}
        style={({ pressed }) => ({
          opacity: controlOpacity(
            resolveControlPhase({ pressed: pressed && Boolean(onCreatorPress) }),
            tokens.motion.pressOpacity,
          ),
        })}
      >
        {showAvatar ? (
          <Image
            source={{ uri: avatarUrl ?? undefined }}
            style={[
              styles.avatar,
              {
                width: avatarSize,
                height: avatarSize,
                borderRadius: tokens.radius.pill,
                borderWidth: tokens.stroke.hairline,
                borderColor: tokens.color.border,
              },
            ]}
            contentFit="cover"
            onError={() => setAvatarFailed(true)}
          />
        ) : (
          <View
            style={[
              styles.avatar,
              styles.avatarFallback,
              {
                width: avatarSize,
                height: avatarSize,
                borderRadius: tokens.radius.pill,
                backgroundColor: tokens.color.surfaceSubtle,
                borderWidth: tokens.stroke.hairline,
                borderColor: tokens.color.border,
              },
            ]}
            accessibilityLabel="Default profile picture"
          >
            <Ionicons name="person-outline" size={Math.round(avatarSize * 0.45)} color={tokens.color.textMuted} />
          </View>
        )}
      </Pressable>

      <View style={[styles.copy, { gap: COPY_STACK_GAP }]}>
        <View style={[styles.creditRow, { gap: tokens.space.xs }]}>
          <Pressable
            onPress={onCreatorPress}
            disabled={!onCreatorPress}
            accessibilityRole={onCreatorPress ? 'link' : 'text'}
            accessibilityLabel={a11yLabel}
            style={({ pressed }) => ({
              opacity: controlOpacity(
                resolveControlPhase({ pressed: pressed && Boolean(onCreatorPress) }),
                tokens.motion.pressOpacity,
              ),
            })}
          >
            <Text style={typeStyle(tokens, 'tileMeta')} numberOfLines={1}>
              {COLLECTION_SECTION_COPY.curatedBy}
            </Text>
          </Pressable>
          {onFollowPress ? (
            <FollowControl
              isFollowing={isFollowing}
              pending={followPending}
              size="micro"
              onPress={onFollowPress}
            />
          ) : null}
        </View>
        <Pressable
          onPress={onCreatorPress}
          disabled={!onCreatorPress}
          accessibilityRole={onCreatorPress ? 'link' : 'text'}
          accessibilityLabel={a11yLabel}
          style={({ pressed }) => [
            styles.handleRow,
            {
              gap: tokens.space.xxs / 2,
              opacity: controlOpacity(
                resolveControlPhase({ pressed: pressed && Boolean(onCreatorPress) }),
                tokens.motion.pressOpacity,
              ),
            },
          ]}
        >
          <Text style={typeStyle(tokens, 'bodyMuted')} numberOfLines={1}>
            {handle}
          </Text>
          {onCreatorPress ? (
            <Ionicons name="chevron-forward-outline" size={12} color={tokens.color.textMuted} />
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    flexShrink: 0,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  creditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    minWidth: 0,
  },
  handleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minWidth: 0,
  },
});
