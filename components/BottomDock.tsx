import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FollowControl } from '@/components/engagement/FollowControl';
import { useThemeMode } from '@/contexts/ThemeContext';
import { trackProductEvent } from '@/src/logging/productAnalytics';
import type { Product, Video } from '@/src/mocks/videos';
import { creatorPath } from '@/src/services/sharePaths';
import {
  creatorDisplayNameFromFeed,
  creatorUsernameFromFeed,
} from '@/src/ui/feedCreatorIdentity';
import {
  FEED_MIN_HIT_TARGET,
  productChipAccessibilityLabel,
} from '@/src/ui/feedA11y';

const CHIP_WIDTH = 84;

function hexWithAlpha(hex: string, alpha: number): string {
  const raw = hex.replace('#', '');
  if (raw.length !== 6) return hex;
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${raw}${a}`;
}

function ProductChip({
  product,
  tokens,
  onPress,
}: {
  product: Product;
  tokens: ReturnType<typeof useThemeMode>['tokens'];
  onPress: (product: Product) => void;
}) {
  const shopable = Boolean(product.catalog_product_id?.trim());
  return (
    <Pressable
      onPress={() => {
        trackProductEvent('product.card.opened', {
          catalogProductId: product.catalog_product_id ?? product.id,
        });
        onPress(product);
      }}
      accessibilityRole="button"
      accessibilityLabel={productChipAccessibilityLabel(product.name, product.price)}
      accessibilityHint={shopable ? undefined : 'Shopping is not available yet'}
      style={[
        styles.chip,
        {
          borderColor: tokens.color.border,
          backgroundColor: tokens.color.surface,
          borderRadius: tokens.radius.md,
        },
      ]}
    >
      <Image
        source={{ uri: product.image }}
        style={styles.chipImage}
        contentFit="cover"
        recyclingKey={`${product.id}:${product.image}`}
      />
      <Text
        style={[styles.chipPrice, { color: tokens.color.text, fontSize: tokens.fontSize.caption }]}
        numberOfLines={1}
      >
        {product.price}
      </Text>
    </Pressable>
  );
}

export type BottomDockFollow = {
  isFollowing: boolean;
  pending?: boolean;
  onPress: () => void;
};

export type BottomDockSave = {
  isSaved: boolean;
  pending?: boolean;
  onPress: () => void;
};

export type BottomDockShare = {
  onPress: () => void;
  accessibilityLabel?: string;
};

export default function BottomDock({
  video,
  onProductPress,
  follow,
  creatorAvatarUrl,
  creatorUsername,
  creatorDisplayName,
  onDockHeightChange,
}: {
  video: Video;
  onProductPress?: (product: Product) => void;
  follow?: BottomDockFollow | null;
  creatorAvatarUrl?: string | null;
  creatorUsername?: string | null;
  creatorDisplayName?: string | null;
  onDockHeightChange?: (height: number) => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tokens } = useThemeMode();
  const products = video.products ?? [];
  const collectionId = video.collection_id?.trim();
  const username = creatorUsername ?? creatorUsernameFromFeed(video);
  const displayName = creatorDisplayName ?? creatorDisplayNameFromFeed(video);

  const handleViewCollection = () => {
    if (!collectionId) return;
    router.push(`/collection/${collectionId}`);
  };

  return (
    <View
      style={styles.wrap}
      pointerEvents="box-none"
      onLayout={(e) => {
        const h = Math.round(e.nativeEvent.layout.height);
        if (h > 0) onDockHeightChange?.(h);
      }}
    >
      <LinearGradient
        pointerEvents="none"
        colors={['transparent', hexWithAlpha(tokens.color.canvas, 0.88)]}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={[styles.hairline, { backgroundColor: hexWithAlpha(tokens.color.accent, 0.45) }]}
      />

      <View
        pointerEvents="box-none"
        style={[
          styles.body,
          {
            paddingHorizontal: tokens.space.md,
            paddingTop: tokens.space.sm,
            paddingBottom: Math.max(insets.bottom, tokens.space.sm),
            gap: tokens.space.xs,
          },
        ]}
      >
        <View style={[styles.titleRow, { gap: tokens.space.sm }]} pointerEvents="box-none">
          <Text
            style={[styles.title, { color: tokens.color.text, fontSize: tokens.fontSize.title }]}
            numberOfLines={1}
          >
            {video.video_title || video.product_name}
          </Text>
        </View>

        <View style={[styles.identityRow, { gap: tokens.space.xs }]}>
          {username ? (
            <Pressable
              onPress={() => router.push(creatorPath(username) as Href)}
              accessibilityRole="link"
              accessibilityLabel={`View ${displayName} profile`}
              style={styles.identityPress}
            >
              {creatorAvatarUrl ? (
                <Image
                  source={{ uri: creatorAvatarUrl }}
                  style={styles.avatar}
                  contentFit="cover"
                />
              ) : null}
              <Text
                style={[
                  styles.creator,
                  { color: tokens.color.textMuted, fontSize: tokens.fontSize.bodyStrong },
                ]}
                numberOfLines={1}
              >
                {displayName}
              </Text>
            </Pressable>
          ) : (
            <View style={styles.identityPress}>
              {creatorAvatarUrl ? (
                <Image
                  source={{ uri: creatorAvatarUrl }}
                  style={styles.avatar}
                  contentFit="cover"
                />
              ) : null}
              <Text
                style={[
                  styles.creator,
                  { color: tokens.color.textMuted, fontSize: tokens.fontSize.bodyStrong },
                ]}
                numberOfLines={1}
              >
                {displayName}
              </Text>
            </View>
          )}
          {follow ? (
            <FollowControl
              size="compact"
              isFollowing={follow.isFollowing}
              pending={follow.pending}
              onPress={follow.onPress}
            />
          ) : null}
        </View>

        {products.length > 0 || collectionId ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled
            directionalLockEnabled
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.rail, { gap: tokens.space.xs, paddingVertical: tokens.space.xxs }]}
          >
            {products.map((product) => (
              <ProductChip
                key={product.id}
                product={product}
                tokens={tokens}
                onPress={(next) => onProductPress?.(next)}
              />
            ))}
            {collectionId ? (
              <Pressable
                onPress={handleViewCollection}
                accessibilityRole="button"
                accessibilityLabel="View collection"
                style={[
                  styles.chip,
                  {
                    borderColor: tokens.color.border,
                    backgroundColor: tokens.color.surface,
                    borderRadius: tokens.radius.md,
                  },
                ]}
              >
                <View
                  style={[
                    styles.chipImage,
                    styles.collectionChipIcon,
                    { backgroundColor: tokens.color.overlay },
                  ]}
                >
                  <Ionicons name="albums-outline" size={22} color={tokens.color.icon} />
                </View>
                <Text
                  style={[styles.chipPrice, { color: tokens.color.text, fontSize: tokens.fontSize.caption }]}
                  numberOfLines={1}
                >
                  View
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
    width: '100%',
  },
  body: {
    width: '100%',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    flex: 1,
    fontWeight: '700',
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  identityPress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
    minWidth: 0,
    minHeight: FEED_MIN_HIT_TARGET,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    flexShrink: 0,
  },
  creator: {
    fontWeight: '600',
    flexShrink: 1,
  },
  rail: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  chip: {
    width: CHIP_WIDTH,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 8,
    alignItems: 'center',
    minHeight: FEED_MIN_HIT_TARGET,
  },
  chipImage: {
    width: 48,
    height: 48,
    borderRadius: 8,
    marginBottom: 4,
  },
  collectionChipIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipPrice: {
    fontWeight: '700',
    textAlign: 'center',
  },
});
