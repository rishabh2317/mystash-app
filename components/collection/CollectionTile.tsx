import React from 'react';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import type { CollectionViewModel } from '@/src/types/collection';
import { useThemeMode } from '@/contexts/ThemeContext';
import { IMMERSIVE_TOKENS, outlineCardChrome } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { formatEngagementCount } from '@/src/ui/formatEngagementCount';
import { personalCollectionTitle, personalProductCountLabel } from '@/src/ui/personalProfile';

/**
 * `tile` is the pre-existing thumbnail + metadata card (Search).
 * `public` is the public-profile grid card: same overlay language as
 * `creatorRail` (thumbnail + views + title on the media).
 * `creatorRail` is the portrait content card used by "More from this creator":
 * the creator's Reel is the subject, so copy sits on the media.
 */
export type CollectionTileVariant = 'tile' | 'creatorRail' | 'personal' | 'reel' | 'public';

type Props = {
  collection: CollectionViewModel;
  /** @deprecated Colors come from ThemeMode tokens. */
  isLight?: boolean;
  variant?: CollectionTileVariant;
  onPress: (collection: CollectionViewModel) => void;
  /** Public grid: save / unsave (same engagement path as reel save). */
  isSaved?: boolean;
  savePending?: boolean;
  onSavePress?: () => void;
};

const PLAY_SIZE = 24;

export function CollectionTile({
  collection,
  variant = 'tile',
  onPress,
  isSaved = false,
  savePending = false,
  onSavePress,
}: Props) {
  const { tokens } = useThemeMode();
  const title = collection.title?.trim() || 'Untitled collection';
  const creatorLabel =
    collection.creator.displayName?.trim() ||
    (collection.creator.username ? `@${collection.creator.username}` : 'Creator');
  const views = Math.max(0, Math.floor(collection.counters?.views ?? 0));
  const productCount = Math.max(0, Math.floor(collection.productCount ?? 0));
  const productLabel = personalProductCountLabel(productCount);
  const a11yLabel = `${title} by ${creatorLabel}, ${views} view${views === 1 ? '' : 's'}`;

  const thumbnail = collection.heroThumbnailUrl ? (
    <Image
      source={{ uri: collection.heroThumbnailUrl }}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
    />
  ) : (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: IMMERSIVE_TOKENS.surfaceSubtle }]} />
  );

  if (variant === 'public') {
    return (
      <Pressable
        onPress={() => onPress(collection)}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        style={({ pressed }) => [
          styles.portrait,
          {
            borderRadius: tokens.radius.md,
            backgroundColor: IMMERSIVE_TOKENS.stage,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: tokens.color.border,
            overflow: 'hidden',
            opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
          },
        ]}
      >
        {thumbnail}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.45)']}
          locations={[0.55, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={[styles.portraitChrome, { padding: tokens.space.xs }]}>
          <View
            style={[
              styles.viewsBadge,
              {
                backgroundColor: 'rgba(0,0,0,0.35)',
                borderRadius: tokens.radius.sm,
                paddingHorizontal: tokens.space.xxs,
                paddingVertical: 1,
                gap: 3,
              },
            ]}
          >
            <Ionicons name="eye-outline" size={10} color={IMMERSIVE_TOKENS.icon} />
            <Text
              style={[
                typeStyle(tokens, 'tileMeta'),
                { color: IMMERSIVE_TOKENS.text, fontSize: tokens.fontSize.micro },
              ]}
            >
              {formatEngagementCount(views)}
            </Text>
          </View>
          <View style={[styles.portraitFooter, { gap: tokens.space.xxs }]}>
            <Text
              style={[
                typeStyle(tokens, 'tileMeta'),
                {
                  flex: 1,
                  color: IMMERSIVE_TOKENS.text,
                  fontSize: tokens.fontSize.caption,
                  lineHeight: tokens.lineHeight.caption,
                  fontFamily: tokens.fontFamily.regular,
                },
              ]}
              numberOfLines={1}
            >
              {productLabel}
            </Text>
            {onSavePress ? (
              <Pressable
                onPress={(e) => {
                  e.stopPropagation?.();
                  onSavePress();
                }}
                accessibilityRole="button"
                accessibilityLabel={isSaved ? 'Unsave collection' : 'Save collection'}
                accessibilityState={{ selected: isSaved, busy: savePending }}
                hitSlop={8}
                disabled={savePending}
                style={[
                  styles.play,
                  {
                    width: PLAY_SIZE - 4,
                    height: PLAY_SIZE - 4,
                    borderRadius: tokens.radius.pill,
                    backgroundColor: 'rgba(0,0,0,0.35)',
                    opacity: savePending ? 0.7 : 1,
                  },
                ]}
              >
                <Ionicons
                  name={isSaved ? 'bookmark' : 'bookmark-outline'}
                  size={11}
                  color={IMMERSIVE_TOKENS.icon}
                />
              </Pressable>
            ) : null}
          </View>
        </View>
      </Pressable>
    );
  }

  if (variant === 'personal') {
    return (
      <Pressable
        onPress={() => onPress(collection)}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        style={({ pressed }) => [
          styles.personalCard,
          {
            opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
            borderRadius: tokens.radius.lg,
            ...outlineCardChrome(tokens),
            borderWidth: StyleSheet.hairlineWidth,
            overflow: 'hidden',
          },
        ]}
      >
        <View
          style={[
            styles.personalThumb,
            {
              backgroundColor: tokens.color.surfaceSubtle,
            },
          ]}
        >
          {thumbnail}
          <View
            style={[
              styles.countBadge,
              {
                top: tokens.space.xs,
                right: tokens.space.xs,
                backgroundColor: tokens.color.canvas,
                borderColor: tokens.semantic.border.subtle,
                borderWidth: StyleSheet.hairlineWidth,
                borderRadius: tokens.radius.pill,
                paddingHorizontal: tokens.space.xs,
                paddingVertical: tokens.space.xxs / 2,
              },
            ]}
          >
            <Text
              style={{
                color: tokens.color.text,
                fontSize: tokens.fontSize.micro,
                lineHeight: tokens.lineHeight.micro,
                fontWeight: tokens.fontWeight.bold,
              }}
            >
              {collection.productCount}
            </Text>
          </View>
        </View>
        <View style={{ paddingHorizontal: tokens.space.xs, paddingVertical: tokens.space.xxs, gap: 4 }}>
          <Text
            style={{
              color: tokens.color.text,
              fontSize: tokens.fontSize.bodyStrong,
              lineHeight: tokens.lineHeight.bodyStrong,
              fontWeight: tokens.fontWeight.bold,
            }}
            numberOfLines={1}
          >
            {personalCollectionTitle(collection)}
          </Text>
          <Text
            style={{
              color: tokens.color.textMuted,
              fontSize: tokens.fontSize.caption,
              lineHeight: tokens.lineHeight.caption,
              fontWeight: tokens.fontWeight.semibold,
            }}
            numberOfLines={1}
          >
            {personalProductCountLabel(collection.productCount)}
          </Text>
        </View>
      </Pressable>
    );
  }

  if (variant === 'reel') {
    return (
      <Pressable
        onPress={() => onPress(collection)}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        style={({ pressed }) => [
          styles.personalCard,
          {
            gap: tokens.space.xs,
            opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
          },
        ]}
      >
        <View
          style={[
            styles.reelThumb,
            {
              borderRadius: tokens.radius.md,
              backgroundColor: IMMERSIVE_TOKENS.stage,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: tokens.color.border,
              overflow: 'hidden',
            },
          ]}
        >
          {thumbnail}
          <View
            style={[
              styles.reelBadge,
              {
                left: tokens.space.xs,
                bottom: tokens.space.xs,
                backgroundColor: 'rgba(0,0,0,0.35)',
                borderRadius: tokens.radius.sm,
                paddingHorizontal: tokens.space.xxs,
                paddingVertical: 1,
                gap: 3,
              },
            ]}
          >
            <Ionicons name="play-outline" size={9} color={IMMERSIVE_TOKENS.icon} />
            <Text
              style={[
                typeStyle(tokens, 'tileMeta'),
                { color: IMMERSIVE_TOKENS.text, fontSize: tokens.fontSize.micro },
              ]}
            >
              {formatEngagementCount(views)}
            </Text>
          </View>
        </View>
        <Text style={typeStyle(tokens, 'tileTitle')} numberOfLines={2}>
          {personalCollectionTitle(collection)}
        </Text>
      </Pressable>
    );
  }

  if (variant === 'creatorRail') {
    const inset = 6;
    const viewsLabel = `${formatEngagementCount(views)} view${views === 1 ? '' : 's'}`;
    return (
      <Pressable
        onPress={() => onPress(collection)}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        style={({ pressed }) => [
          styles.discoverCard,
          {
            ...outlineCardChrome(tokens),
            borderRadius: tokens.radius.lg,
            padding: inset,
            opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
          },
        ]}
      >
        <View
          style={[
            styles.discoverMedia,
            {
              borderRadius: tokens.radius.md,
              backgroundColor: tokens.color.surfaceSubtle,
            },
          ]}
        >
          {thumbnail}
          <View
            style={[
              styles.viewsBadge,
              {
                position: 'absolute',
                top: tokens.space.xs,
                left: tokens.space.xs,
                backgroundColor: IMMERSIVE_TOKENS.controlStrong,
                borderRadius: tokens.radius.sm,
                paddingHorizontal: tokens.space.xxs,
                paddingVertical: tokens.space.xxs / 2,
                gap: tokens.space.xxs / 2,
              },
            ]}
          >
            <Ionicons name="eye-outline" size={11} color={IMMERSIVE_TOKENS.icon} />
            <Text
              style={{
                color: IMMERSIVE_TOKENS.text,
                fontFamily: tokens.fontFamily.semibold,
                fontSize: tokens.fontSize.micro,
                lineHeight: tokens.lineHeight.micro,
              }}
            >
              {formatEngagementCount(views)}
            </Text>
          </View>
        </View>
        <View
          style={{
            paddingTop: tokens.space.xs,
            paddingHorizontal: 2,
            gap: 2,
          }}
        >
          <Text style={typeStyle(tokens, 'tileTitle')} numberOfLines={1}>
            {title}
          </Text>
          <Text style={typeStyle(tokens, 'tileMeta')} numberOfLines={1}>
            {viewsLabel}
          </Text>
        </View>
      </Pressable>
    );
  }

  // `tile` is unchanged from before the Collection redesign: Search still
  // renders it, so its geometry and colours stay exactly as they were.
  return (
    <Pressable
      onPress={() => onPress(collection)}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      style={({ pressed }) => [
        styles.tile,
        {
          ...outlineCardChrome(tokens),
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      <View>
        {collection.heroThumbnailUrl ? (
          <Image
            source={{ uri: collection.heroThumbnailUrl }}
            style={styles.thumb}
            contentFit="cover"
          />
        ) : (
          <View
            style={[styles.thumb, { backgroundColor: tokens.color.canvasEnd }]}
          />
        )}
        <View style={styles.legacyBadge} accessibilityElementsHidden>
          <Ionicons name="eye-outline" size={12} color="#F8FAFC" />
          <Text style={styles.viewsText}>{views}</Text>
        </View>
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: tokens.color.text }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[styles.meta, { color: tokens.color.textMuted }]} numberOfLines={1}>
          {creatorLabel}
        </Text>
        <Text style={[styles.meta, { color: tokens.color.textMuted }]}>
          {collection.productCount} product{collection.productCount === 1 ? '' : 's'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    flex: 1,
  },
  thumb: {
    width: '100%',
    aspectRatio: 9 / 12,
    backgroundColor: '#111',
  },
  legacyBadge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  viewsText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
  },
  body: {
    padding: 10,
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  meta: {
    fontSize: 12,
  },
  portrait: {
    width: '100%',
    aspectRatio: 9 / 14,
    overflow: 'hidden',
    position: 'relative',
  },
  discoverCard: {
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
  },
  discoverMedia: {
    width: '100%',
    aspectRatio: 9 / 14,
    overflow: 'hidden',
    position: 'relative',
  },
  portraitChrome: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  viewsBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
  },
  portraitFooter: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  play: {
    width: PLAY_SIZE,
    height: PLAY_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personalCard: {
    gap: 6,
  },
  personalThumb: {
    width: '100%',
    aspectRatio: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  reelThumb: {
    width: '100%',
    aspectRatio: 4 / 5,
    overflow: 'hidden',
    position: 'relative',
  },
  countBadge: {
    position: 'absolute',
  },
  reelBadge: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
  },
});
