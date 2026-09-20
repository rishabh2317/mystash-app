import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

import { useThemeMode } from '@/contexts/ThemeContext';
import { IMMERSIVE_TOKENS } from '@/src/theme/tokens';
import type { CollectionDetailViewModel } from '@/src/types/collectionDetail';
import {
  buildCollectionPreviewVideo,
  collectionMediaFrameSize,
  collectionMediaSourceUrl,
  collectionMediaWatchLinkLabel,
  originalReelPlatformLabel,
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

const CONTROL_SIZE = 36;
const PLAY_SIZE = 56;

/**
 * Portrait editorial presentation of the source Reel — the Collection's
 * evidence, not a second Home feed. Reuses the home-feed WebView embeds
 * with Collection crop/loop so native title/end-screen chrome stays off-frame.
 * The centre control plays and pauses the inline player.
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
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);

  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { width: playerWidth, height: playerHeight } = collectionMediaFrameSize({
    screenWidth,
    screenHeight,
  });
  const previewVideo = useMemo(() => buildCollectionPreviewVideo(collection), [collection]);
  const platformLabel = originalReelPlatformLabel(media.platform);
  const sourceUrl = collectionMediaSourceUrl(media);
  const watchLinkLabel = collectionMediaWatchLinkLabel(media.platform);

  const urlInfo = previewVideo?.url ? getVideoUrlInfo(previewVideo.url) : null;
  const embedUrl = previewVideo?.embed_url ?? media.embedUrl;
  const canEmbed =
    isActive &&
    embedUrl &&
    urlInfo?.isValid &&
    (urlInfo.platform === 'youtube' || urlInfo.platform === 'instagram');

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
          setPlaying(true);
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

  const injectPlayer = (script: string) => {
    webViewRef.current?.injectJavaScript(script);
  };

  const openSourceUrl = useCallback(async () => {
    if (!sourceUrl) return;
    await openBrowserAsync(sourceUrl, {
      presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
    });
  }, [sourceUrl]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    injectPlayer(`
      (function() {
        try {
          if (typeof window.__mystashSetMuted === 'function') {
            window.__mystashSetMuted(${next ? 'true' : 'false'});
          } else {
            window.__mystashPendingMuted = ${next ? 'true' : 'false'};
          }
        } catch (e) {}
        true;
      })();
    `);
  };

  const togglePlayback = () => {
    const next = !playing;
    setPlaying(next);
    injectPlayer(`
      (function() {
        try {
          if (typeof window.__mystashSetPlaying === 'function') {
            window.__mystashSetPlaying(${next ? 'true' : 'false'});
          }
        } catch (e) {}
        true;
      })();
    `);
  };

  const controlStyle = (pressed: boolean) => [
    styles.control,
    {
      width: CONTROL_SIZE,
      height: CONTROL_SIZE,
      borderRadius: tokens.radius.pill,
      backgroundColor: IMMERSIVE_TOKENS.control,
      opacity: controlOpacity(resolveControlPhase({ pressed }), tokens.motion.pressOpacity),
    },
  ];

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
        {previewVideo?.thumbnail || media.posterUrl ? (
          <Animated.View
            style={[styles.posterLayer, { opacity: showWebView ? 0 : fadeAnim }]}
            pointerEvents="none"
          >
            <Image
              source={{ uri: previewVideo?.thumbnail ?? media.posterUrl ?? undefined }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
            />
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

        <View style={[styles.chrome, { padding: tokens.space.sm }]} pointerEvents="box-none">
          <View style={styles.chromeCenter} pointerEvents="box-none">
            <Pressable
              onPress={togglePlayback}
              accessibilityRole="button"
              accessibilityLabel={playing ? 'Pause reel' : 'Play reel'}
              style={({ pressed }) => [
                styles.control,
                {
                  width: PLAY_SIZE,
                  height: PLAY_SIZE,
                  borderRadius: tokens.radius.pill,
                  backgroundColor: IMMERSIVE_TOKENS.scrim,
                  opacity: controlOpacity(
                    resolveControlPhase({ pressed }),
                    tokens.motion.pressOpacity,
                  ),
                },
              ]}
            >
              <Ionicons
                name={playing ? 'pause' : 'play'}
                size={24}
                color={IMMERSIVE_TOKENS.icon}
              />
            </Pressable>
          </View>

          <View style={styles.chromeFooter} pointerEvents="box-none">
            <View
              style={[
                styles.platformPill,
                {
                  backgroundColor: IMMERSIVE_TOKENS.control,
                  borderRadius: tokens.radius.pill,
                  paddingHorizontal: tokens.space.xs,
                  paddingVertical: tokens.space.xxs,
                },
              ]}
            >
              <Text
                style={{
                  color: IMMERSIVE_TOKENS.text,
                  fontSize: tokens.fontSize.micro,
                  lineHeight: tokens.lineHeight.micro,
                  fontWeight: tokens.fontWeight.bold,
                }}
              >
                {platformLabel}
              </Text>
            </View>
            {canEmbed ? (
              <Pressable
                onPress={toggleMute}
                accessibilityRole="button"
                accessibilityLabel={muted ? 'Unmute reel' : 'Mute reel'}
                hitSlop={hitSlopToMinTarget(CONTROL_SIZE)}
                style={({ pressed }) => controlStyle(pressed)}
              >
                <Ionicons
                  name={muted ? 'volume-mute' : 'volume-high'}
                  size={18}
                  color={IMMERSIVE_TOKENS.icon}
                />
              </Pressable>
            ) : null}
          </View>
        </View>
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
          <Text
            style={{
              color: tokens.color.textMuted,
              fontSize: tokens.fontSize.caption,
              lineHeight: tokens.lineHeight.caption,
              fontWeight: tokens.fontWeight.semibold,
              textAlign: 'center',
            }}
          >
            {watchLinkLabel}
          </Text>
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
  chrome: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  chromeCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chromeFooter: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  platformPill: {
    alignSelf: 'flex-end',
  },
  control: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
