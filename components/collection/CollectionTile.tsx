import React from 'react';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CollectionViewModel } from '@/src/types/collection';
import { useThemeMode } from '@/contexts/ThemeContext';
import { IMMERSIVE_TOKENS, mediaScrimGradient } from '@/src/theme/tokens';
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
};

const PLAY_SIZE = 24;

export function CollectionTile({ collection, variant = 'tile', onPress }: Props) {
  const { tokens } = useThemeMode();
  const title = collection.title?.trim() || 'Untitled collection';
  const creatorLabel =
    collection.creator.displayName?.trim() ||
    (collection.creator.username ? `@${collection.creator.username}` : 'Creator');
  const views = Math.max(0, Math.floor(collection.counters?.views ?? 0));
  const a11yLabel = `${title} by ${creatorLabel}, ${views} view${views === 1 ? '' : 's'}`;
  const scrim = mediaScrimGradient();

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
            borderRadius: tokens.radius.lg,
            backgroundColor: IMMERSIVE_TOKENS.stage,
            opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
          },
        ]}
      >
        {thumbnail}
        <LinearGradient
          colors={[...scrim.colors]}
          locations={[...scrim.locations]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={[styles.portraitChrome, { padding: tokens.space.xs }]}>
          <View
            style={[
              styles.viewsBadge,
              {
                backgroundColor: IMMERSIVE_TOKENS.control,
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
                fontSize: tokens.fontSize.micro,
                lineHeight: tokens.lineHeight.micro,
                fontWeight: tokens.fontWeight.bold,
              }}
            >
              {formatEngagementCount(views)}
            </Text>
          </View>
          <View style={[styles.portraitFooter, { gap: tokens.space.xs }]}>
            <Text
              style={{
                flex: 1,
                color: IMMERSIVE_TOKENS.text,
                fontSize: tokens.fontSize.caption,
                lineHeight: tokens.lineHeight.caption,
                fontWeight: tokens.fontWeight.bold,
                textShadowColor: IMMERSIVE_TOKENS.textShadow,
                textShadowOffset: { width: 0, height: 1 },
                textShadowRadius: 3,
              }}
              numberOfLines={2}
            >
              {title}
            </Text>
            <View
              style={[
                styles.play,
                {
                  borderRadius: tokens.radius.pill,
                  backgroundColor: IMMERSIVE_TOKENS.control,
                },
              ]}
            >
              <Ionicons name="play" size={12} color={IMMERSIVE_TOKENS.icon} />
            </View>
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
            backgroundColor: tokens.color.surface,
            borderColor: tokens.color.border,
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
                backgroundColor: tokens.color.surfaceRaised,
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
            opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
          },
        ]}
      >
        <View
          style={[
            styles.reelThumb,
            {
              borderRadius: tokens.radius.lg,
              backgroundColor: IMMERSIVE_TOKENS.stage,
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
                backgroundColor: IMMERSIVE_TOKENS.control,
                borderRadius: tokens.radius.pill,
                paddingHorizontal: tokens.space.xs,
                paddingVertical: tokens.space.xxs / 2,
                gap: tokens.space.xxs / 2,
              },
            ]}
          >
            <Ionicons name="play" size={10} color={IMMERSIVE_TOKENS.icon} />
            <Text
              style={{
                color: IMMERSIVE_TOKENS.text,
                fontSize: tokens.fontSize.micro,
                lineHeight: tokens.lineHeight.micro,
                fontWeight: tokens.fontWeight.bold,
              }}
            >
              {formatEngagementCount(views)}
            </Text>
          </View>
        </View>
        <Text
          style={{
            color: tokens.color.text,
            fontSize: tokens.fontSize.bodyStrong,
            lineHeight: tokens.lineHeight.bodyStrong,
            fontWeight: tokens.fontWeight.bold,
          }}
          numberOfLines={2}
        >
          {personalCollectionTitle(collection)}
        </Text>
      </Pressable>
    );
  }

  if (variant === 'creatorRail') {
    return (
      <Pressable
        onPress={() => onPress(collection)}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        style={({ pressed }) => [
          styles.portrait,
          {
            borderRadius: tokens.radius.lg,
            backgroundColor: IMMERSIVE_TOKENS.stage,
            opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
          },
        ]}
      >
        {thumbnail}
        <LinearGradient
          colors={[...scrim.colors]}
          locations={[...scrim.locations]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={[styles.portraitChrome, { padding: tokens.space.xs }]}>
          <View
            style={[
              styles.viewsBadge,
              {
                backgroundColor: IMMERSIVE_TOKENS.control,
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
                fontSize: tokens.fontSize.micro,
                lineHeight: tokens.lineHeight.micro,
                fontWeight: tokens.fontWeight.bold,
              }}
            >
              {formatEngagementCount(views)}
            </Text>
          </View>
          <View style={[styles.portraitFooter, { gap: tokens.space.xs }]}>
            <Text
              style={{
                flex: 1,
                color: IMMERSIVE_TOKENS.text,
                fontSize: tokens.fontSize.caption,
                lineHeight: tokens.lineHeight.caption,
                fontWeight: tokens.fontWeight.bold,
                textShadowColor: IMMERSIVE_TOKENS.textShadow,
                textShadowOffset: { width: 0, height: 1 },
                textShadowRadius: 3,
              }}
              numberOfLines={2}
            >
              {title}
            </Text>
            <View
              style={[
                styles.play,
                {
                  borderRadius: tokens.radius.pill,
                  backgroundColor: IMMERSIVE_TOKENS.control,
                },
              ]}
            >
              <Ionicons name="play" size={12} color={IMMERSIVE_TOKENS.icon} />
            </View>
          </View>
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
          backgroundColor: tokens.color.surface,
          borderColor: tokens.color.border,
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
