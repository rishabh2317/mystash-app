import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FollowControl } from '@/components/engagement/FollowControl';
import { ExpandableText } from '@/components/ui/ExpandableText';
import { MetaBar } from '@/components/ui/MetaBar';
import { useThemeMode } from '@/contexts/ThemeContext';
import type { CollectionDetailViewModel } from '@/src/types/collectionDetail';
import { COLLECTION_SECTION_COPY, collectionMetaItems } from '@/src/ui/collectionSections';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';

type Props = {
  collection: CollectionDetailViewModel;
  onCreatorPress?: () => void;
  isFollowing?: boolean;
  followPending?: boolean;
  onFollowPress?: () => void;
};

/** Two lines of identity (name + handle) sit beside the avatar. */
const AVATAR_SIZE = 48;
/** Lines of the collection title shown before the expand toggle appears. */
const TITLE_COLLAPSED_LINES = 2;

/**
 * Creator context → collection title → quiet metadata.
 * Establishes "who curated this" without becoming a creator profile: only
 * identity fields present on the Collection are shown.
 */
export function CollectionHero({
  collection,
  onCreatorPress,
  isFollowing = false,
  followPending = false,
  onFollowPress,
}: Props) {
  const { tokens } = useThemeMode();
  const username = collection.creator.username?.trim() || null;
  const handle = username ? `@${username}` : null;
  const creatorLabel = collection.creator.displayName?.trim() || handle || 'Creator';
  const title = collection.title?.trim() || 'Collection';
  const caption = collection.caption?.trim() ?? '';
  const metaItems = collectionMetaItems(collection);
  const a11yLabel = `Curated by ${creatorLabel}${handle ? `, ${handle}` : ''}`;
  const avatarUrl = collection.creator.avatarUrl?.trim() || null;
  const [avatarFailed, setAvatarFailed] = useState(false);
  const showAvatar = Boolean(avatarUrl) && !avatarFailed;
  useEffect(() => {
    setAvatarFailed(false);
  }, [avatarUrl]);

  return (
    <View style={{ gap: tokens.space.sm, paddingTop: tokens.space.xs }}>
      <View style={[styles.creatorRow, { gap: tokens.space.xs }]}>
        <Pressable
          onPress={onCreatorPress}
          disabled={!onCreatorPress}
          accessibilityRole={onCreatorPress ? 'link' : 'text'}
          accessibilityLabel={a11yLabel}
          style={({ pressed }) => [
            styles.creatorPress,
            {
              gap: tokens.space.sm,
              opacity: controlOpacity(
                resolveControlPhase({ pressed: pressed && Boolean(onCreatorPress) }),
                tokens.motion.pressOpacity,
              ),
            },
          ]}
        >
          {showAvatar ? (
            <Image
              source={{ uri: avatarUrl ?? undefined }}
              style={[
                styles.avatar,
                {
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
                  borderRadius: tokens.radius.pill,
                  backgroundColor: tokens.color.surfaceSubtle,
                  borderWidth: tokens.stroke.hairline,
                  borderColor: tokens.color.border,
                },
              ]}
              accessibilityLabel="Default profile picture"
            >
              <Ionicons name="person" size={22} color={tokens.color.textMuted} />
            </View>
          )}
          <View style={styles.creatorCopy}>
            <Text
              style={{
                color: tokens.color.text,
                fontSize: tokens.fontSize.title,
                lineHeight: tokens.lineHeight.title,
                fontWeight: tokens.fontWeight.bold,
              }}
              numberOfLines={1}
            >
              {creatorLabel}
            </Text>
            {handle ? (
              <View style={[styles.handleRow, { gap: tokens.space.xxs / 2 }]}>
                <Text
                  style={{
                    color: tokens.color.textMuted,
                    fontSize: tokens.fontSize.label,
                    lineHeight: tokens.lineHeight.label,
                  }}
                  numberOfLines={1}
                >
                  {handle}
                </Text>
                {onCreatorPress ? (
                  <Ionicons name="chevron-forward" size={13} color={tokens.color.textMuted} />
                ) : null}
              </View>
            ) : null}
          </View>
        </Pressable>
        {onFollowPress ? (
          <FollowControl
            isFollowing={isFollowing}
            pending={followPending}
            size="compact"
            onPress={onFollowPress}
          />
        ) : null}
      </View>

      <ExpandableText
        text={title}
        collapsedLines={TITLE_COLLAPSED_LINES}
        accessibilityRole="header"
        expandLabel={COLLECTION_SECTION_COPY.showMore}
        collapseLabel={COLLECTION_SECTION_COPY.showLess}
        style={{
          color: tokens.color.text,
          fontSize: tokens.fontSize.section,
          lineHeight: tokens.lineHeight.section,
          fontWeight: tokens.fontWeight.bold,
        }}
      />

      {caption ? (
        <Text
          style={{
            color: tokens.color.textMuted,
            fontSize: tokens.fontSize.body,
            lineHeight: tokens.lineHeight.body,
          }}
        >
          {caption}
        </Text>
      ) : null}

      <MetaBar items={metaItems.map((item) => ({ ...item }))} />
    </View>
  );
}

const styles = StyleSheet.create({
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  creatorPress: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    minWidth: 0,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorCopy: {
    flexShrink: 1,
    minWidth: 0,
  },
  handleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
