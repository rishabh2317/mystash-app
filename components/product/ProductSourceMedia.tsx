import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import { useRouter, type Href } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { IMMERSIVE_TOKENS } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import type { ProductPageSource } from '@/src/types/productPage';
import {
  PRODUCT_PAGE_COPY,
  discoverySourcePath,
  discoveryWatchLabel,
  relatedMediaPosterUrl,
} from '@/src/ui/productPage';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';

type Props = {
  source: ProductPageSource;
  /**
   * Full-width editorial post (default). Avoids autoplay WebViews so Shorts /
   * Reel chrome never shows on the Product Page.
   */
  compact?: boolean;
};

const PLAY_SIZE = 52;
const GUTTER = 16;

/**
 * Discovery media as a quiet post: poster + play.
 * When the source is a published collection, tap opens the same in-app reel
 * host as Featured collections; otherwise opens the original URL.
 */
export function ProductSourceMedia({ source }: Props) {
  const router = useRouter();
  const { tokens } = useThemeMode();
  const { width: screenWidth } = useWindowDimensions();
  const width = Math.max(0, screenWidth - GUTTER * 2);
  const height = Math.round(width * 1.12);
  const posterUrl = useMemo(
    () => relatedMediaPosterUrl({ url: source.url, thumbnailUrl: null }),
    [source.url],
  );
  const watchLabel = discoveryWatchLabel(source);

  const openSource = () => {
    const reelPath = discoverySourcePath(source);
    if (reelPath) {
      router.push(reelPath as Href);
      return;
    }
    void openBrowserAsync(source.url, { presentationStyle: WebBrowserPresentationStyle.AUTOMATIC });
  };

  return (
    <View style={{ gap: tokens.space.sm, width: '100%' }}>
      <Pressable
        onPress={openSource}
        accessibilityRole="button"
        accessibilityLabel={PRODUCT_PAGE_COPY.viewOriginal}
        style={({ pressed }) => [
          styles.frame,
          {
            width,
            height,
            borderRadius: tokens.radius.lg,
            backgroundColor: IMMERSIVE_TOKENS.stage,
            borderColor: tokens.color.border,
            opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
          },
        ]}
      >
        {posterUrl ? (
          <Image source={{ uri: posterUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: tokens.color.surfaceSubtle }]} />
        )}
        <View
          style={[
            styles.play,
            {
              width: PLAY_SIZE,
              height: PLAY_SIZE,
              borderRadius: tokens.radius.pill,
              backgroundColor: IMMERSIVE_TOKENS.control,
            },
          ]}
          pointerEvents="none"
        >
          <Ionicons name="play-outline" size={22} color={IMMERSIVE_TOKENS.icon} style={{ marginLeft: 2 }} />
        </View>
      </Pressable>
      <Pressable onPress={openSource} accessibilityRole="link" accessibilityLabel={watchLabel}>
        <Text style={typeStyle(tokens, 'link')}>{`${watchLabel} →`}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  play: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
