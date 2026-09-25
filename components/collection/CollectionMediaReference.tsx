import { Image } from 'expo-image';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

import { Text } from '@/components/ui/Text';
import { useThemeMode } from '@/contexts/ThemeContext';
import { IMMERSIVE_TOKENS } from '@/src/theme/tokens';
import { typeStyle } from '@/src/theme/typography';
import type { CollectionDetailViewModel } from '@/src/types/collectionDetail';
import {
  buildCollectionPreviewVideo,
  collectionMediaFrameSize,
  collectionMediaSourceUrl,
  collectionMediaWatchLinkLabel,
  COLLECTION_YOUTUBE_CROP_SCALE,
  type CollectionMediaReferenceModel,
} from '@/src/ui/collectionLayout';
import { controlOpacity, resolveControlPhase } from '@/src/ui/contracts';
import { hitSlopToMinTarget } from '@/src/ui/feedA11y';
import { buildInstagramEmbedHtml } from '@/src/utils/instagramWebViewEmbed';
import { getVideoUrlInfo } from '@/src/utils/videoUtils';
import {
  buildYoutubeWebHtml,
  extractYoutubeVideoIdFromUrl,
  resolveYoutubeParentOrigin,
} from '@/src/utils/youtubeWebViewEmbed';

type Props = {
  media: CollectionMediaReferenceModel;
  collection: CollectionDetailViewModel;
  /** Pause/unmount embed when the Collection route loses focus. */
  isActive?: boolean;
};

/**
 * Portrait editorial presentation of the source Reel — immersive media only.
 * No play/mute overlay chrome; embed auto-starts when focused.
 */
export function CollectionMediaReference({
  media,
  collection,
  isActive = true,
}: Props) {
  const { tokens } = useThemeMode();
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const webViewRef = useRef<WebView>(null);
  const [showWebView, setShowWebView] = useState(false);

  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { width: playerWidth, height: playerHeight } = collectionMediaFrameSize({
    screenWidth,
    screenHeight,
  });
  const previewVideo = useMemo(() => buildCollectionPreviewVideo(collection), [collection]);
  const sourceUrl = collectionMediaSourceUrl(media);
  const watchLinkLabel = collectionMediaWatchLinkLabel(media.platform);
  const posterUri = previewVideo?.thumbnail || media.posterUrl || null;

  const urlInfo = previewVideo?.url ? getVideoUrlInfo(previewVideo.url) : null;
  const embedUrl = previewVideo?.embed_url ?? media.embedUrl;
  const canEmbed =
    isActive &&
    Boolean(embedUrl) &&
    Boolean(urlInfo?.isValid) &&
    (urlInfo?.platform === 'youtube' || urlInfo?.platform === 'instagram');

  const parentOrigin = useMemo(() => resolveYoutubeParentOrigin(), []);
  const youtubeId = embedUrl ? extractYoutubeVideoIdFromUrl(embedUrl) : null;
  const youtubeHtml = useMemo(
    () =>
      youtubeId && embedUrl
        ? buildYoutubeWebHtml(youtubeId, parentOrigin, COLLECTION_YOUTUBE_CROP_SCALE, {
            loop: true,
          })
        : null,
    [youtubeId, embedUrl, parentOrigin],
  );
  const instagramHtml = useMemo(
    () =>
      embedUrl && urlInfo?.platform === 'instagram'
        ? buildInstagramEmbedHtml(embedUrl, { crop: 'collection' })
        : null,
    [embedUrl, urlInfo?.platform],
  );

  useEffect(() => {
    if (canEmbed) {
      const timer = setTimeout(() => {
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: tokens.motion.thumbnailFadeMs,
          useNativeDriver: true,
        }).start(() => {
          setShowWebView(true);
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: tokens.motion.thumbnailFadeMs,
            useNativeDriver: true,
          }).start();
        });
      }, 120);
      return () => clearTimeout(timer);
    }
    setShowWebView(false);
    fadeAnim.setValue(1);
  }, [canEmbed, fadeAnim, tokens.motion.thumbnailFadeMs]);

  const openSourceUrl = useCallback(async () => {
    if (!sourceUrl) return;
    await openBrowserAsync(sourceUrl, {
      presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
    });
  }, [sourceUrl]);

  return (
    <View style={[styles.center, { gap: tokens.space.xs }]}>
      <View
        style={[
          styles.frame,
          {
            width: playerWidth,
            height: playerHeight,
            borderRadius: tokens.radius.xl,
            backgroundColor: IMMERSIVE_TOKENS.stage,
            borderColor: tokens.color.border,
          },
        ]}
      >
        {posterUri ? (
          <Animated.View
            style={[styles.posterLayer, { opacity: showWebView ? 0 : fadeAnim }]}
            pointerEvents="none"
          >
            <Image source={{ uri: posterUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          </Animated.View>
        ) : null}

        {showWebView && canEmbed && urlInfo?.platform === 'youtube' && youtubeHtml ? (
          <Animated.View style={[styles.playerLayer, { opacity: fadeAnim }]}>
            <WebView
              ref={webViewRef}
              source={{ html: youtubeHtml, baseUrl: `${parentOrigin}/` }}
              style={styles.webView}
              originWhitelist={['*']}
              javaScriptEnabled
              domStorageEnabled
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              allowsFullscreenVideo={false}
              scrollEnabled={false}
              bounces={false}
              androidLayerType="hardware"
              userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
            />
          </Animated.View>
        ) : null}

        {showWebView && canEmbed && urlInfo?.platform === 'instagram' && instagramHtml ? (
          <Animated.View style={[styles.playerLayer, { opacity: fadeAnim }]}>
            <WebView
              ref={webViewRef}
              source={{ html: instagramHtml, baseUrl: 'https://www.instagram.com' }}
              style={styles.webView}
              javaScriptEnabled
              domStorageEnabled
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              allowsFullscreenVideo={false}
              scrollEnabled={false}
              bounces={false}
              androidLayerType="hardware"
              userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
            />
          </Animated.View>
        ) : null}
      </View>

      {sourceUrl && watchLinkLabel ? (
        <Pressable
          onPress={() => void openSourceUrl()}
          accessibilityRole="link"
          accessibilityLabel={`${watchLinkLabel}, ${sourceUrl}`}
          hitSlop={hitSlopToMinTarget(20)}
          style={({ pressed }) => [
            {
              opacity: controlOpacity(
                resolveControlPhase({ pressed }),
                tokens.motion.pressOpacity,
              ),
            },
          ]}
        >
          <Text style={typeStyle(tokens, 'link')}>{watchLinkLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
  },
  frame: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  posterLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  playerLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  webView: {
    flex: 1,
    backgroundColor: IMMERSIVE_TOKENS.stage,
  },
});
