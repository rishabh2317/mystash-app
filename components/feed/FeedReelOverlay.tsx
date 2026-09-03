import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FeedCreatorBlock } from './FeedCreatorBlock';
import { FeedProductShelf } from './FeedProductShelf';
import { useThemeMode } from '@/contexts/ThemeContext';
import type { Product, Video } from '@/src/mocks/videos';
import { IMMERSIVE_TOKENS, mediaScrimGradient } from '@/src/theme/tokens';
import type { FeedReelFollow } from '@/src/ui/feedReelTypes';
import { getVideoUrlInfo } from '@/src/utils/videoUtils';

/**
 * Horizontal inset for content resting on media. Deliberately tighter than
 * `space.md` so the shelf can show three product chips on small phones.
 */
const MEDIA_GUTTER = 14;
/** Extra lift above the home indicator when no tab bar inset is reserved. */
const MEDIA_HOME_INDICATOR_LIFT = 6;

type Props = {
  video: Video;
  displayName: string;
  username?: string | null;
  avatarUrl?: string | null;
  follow?: FeedReelFollow | null;
  onProductPress?: (product: Product) => void;
  onOverlayHeightChange?: (height: number) => void;
  /**
   * Extra space above the absolute Home tab bar (full tab bar height including
   * safe-area). Omit on Search/Focused reel hosts that have no tab bar.
   */
  bottomChromeInset?: number;
};

export function FeedReelOverlay({
  video,
  displayName,
  username,
  avatarUrl,
  follow,
  onProductPress,
  onOverlayHeightChange,
  bottomChromeInset = 0,
}: Props) {
  const insets = useSafeAreaInsets();
  const { tokens } = useThemeMode();
  const scrim = mediaScrimGradient();
  const title = video.video_title?.trim() || video.product_name?.trim() || 'Reel';
  const products = video.products ?? [];
  const collectionId = video.collection_id?.trim() || null;
  const isInstagram =
    Boolean(video.url) && getVideoUrlInfo(video.url).platform === 'instagram';

  /** When a tab bar inset is reserved it already includes home-indicator safe area. */
  const paddingBottom =
    bottomChromeInset > 0
      ? bottomChromeInset + tokens.space.xs
      : Math.max(insets.bottom, tokens.space.xs) + MEDIA_HOME_INDICATOR_LIFT;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {isInstagram ? null : (
        <LinearGradient
          pointerEvents="none"
          colors={[...scrim.colors]}
          locations={[...scrim.locations]}
          style={StyleSheet.absoluteFill}
        />
      )}
      <View
        pointerEvents="box-none"
        style={[
          styles.content,
          isInstagram ? styles.igContent : null,
          isInstagram
            ? {
                borderTopLeftRadius: tokens.radius.xxl,
                borderTopRightRadius: tokens.radius.xxl,
              }
            : null,
          {
            paddingHorizontal: MEDIA_GUTTER,
            paddingBottom,
            gap: tokens.space.sm,
          },
        ]}
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          if (h > 0) onOverlayHeightChange?.(h);
        }}
      >
        <FeedCreatorBlock
          displayName={displayName}
          username={username}
          avatarUrl={avatarUrl}
          title={title}
          follow={follow}
        />
        <FeedProductShelf
          products={products}
          collectionId={collectionId}
          onProductPress={onProductPress}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 8,
  },
  content: {
    width: '100%',
  },
  /** Full-width opaque dock; rounded top corners only. */
  igContent: {
    backgroundColor: IMMERSIVE_TOKENS.surface,
    paddingTop: MEDIA_GUTTER,
    overflow: 'hidden',
  },
});
