import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import { useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

import { useThemeMode } from '@/contexts/ThemeContext';
import type { CollectionDetailViewModel } from '@/src/types/collectionDetail';
import {
  buildCollectionPreviewVideo,
  collectionMediaSourceUrl,
  collectionMediaWatchLinkLabel,
  collectionReelPlayerSize,
  originalReelPlatformLabel,
  type CollectionMediaReferenceModel,
} from '@/src/ui/collectionLayout';
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
 * Compact portrait inline player for the source Reel.
 * Reuses home-feed WebView embeds; expand opens `/reel/[collectionId]`.
 */
export function CollectionMediaReference({
  media,
  collection,
  isActive = true,
}: Props) {
  const router = useRouter();
  const { tokens, mode } = useThemeMode();
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const webViewRef = useRef<WebView>(null);
  const [showWebView, setShowWebView] = useState(false);
  const [muted, setMuted] = useState(true);

  const screenWidth = Dimensions.get('window').width;
  const { width: playerWidth, height: playerHeight } = collectionReelPlayerSize(screenWidth);
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
        ? buildYoutubeWebHtml(youtubeId, parentOrigin)
        : null,
    [youtubeId, embedUrl, parentOrigin],
  );
  const instagramHtml = useMemo(
    () =>
      embedUrl && urlInfo?.platform === 'instagram'
        ? buildInstagramEmbedHtml(embedUrl, { crop: 'inline' })
        : null,
    [embedUrl, urlInfo?.platform],
  );

  useEffect(() => {
    if (canEmbed) {
      const timer = setTimeout(() => {
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 280,
          useNativeDriver: true,
        }).start(() => {
          setShowWebView(true);
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 280,
            useNativeDriver: true,
          }).start();
        });
      }, 120);
      return () => clearTimeout(timer);
    }
    setShowWebView(false);
    fadeAnim.setValue(1);
  }, [canEmbed, fadeAnim]);

  const openReel = () => {
    router.push(media.reelPath as Href);
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
    webViewRef.current?.injectJavaScript(`
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

  return (
    <View style={styles.wrap}>
      <View style={styles.center}>
        <View
          style={[
            styles.frame,
            {
              width: playerWidth,
              height: playerHeight,
              borderRadius: tokens.radius.xl,
              backgroundColor: '#0A0A0A',
              borderColor: tokens.color.border,
              shadowColor: mode === 'titanium' ? '#0F172A' : '#000',
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
              <View style={styles.posterScrim} />
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

          <View style={styles.chrome} pointerEvents="box-none">
            <View style={[styles.platformPill, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
              <Text style={styles.platformText}>{platformLabel}</Text>
            </View>
            <View style={styles.chromeRight} pointerEvents="box-none">
              <Pressable
                onPress={openReel}
                accessibilityRole="button"
                accessibilityLabel="Open full screen reel"
                style={({ pressed }) => [
                  styles.iconBtn,
                  { opacity: pressed ? 0.85 : 1, backgroundColor: 'rgba(0,0,0,0.45)' },
                ]}
              >
                <Ionicons name="expand-outline" size={18} color="#F8FAFC" />
              </Pressable>
              {canEmbed ? (
                <Pressable
                  onPress={toggleMute}
                  accessibilityRole="button"
                  accessibilityLabel={muted ? 'Unmute reel' : 'Mute reel'}
                  style={({ pressed }) => [
                    styles.iconBtn,
                    { opacity: pressed ? 0.85 : 1, backgroundColor: 'rgba(0,0,0,0.45)' },
                  ]}
                >
                  <Ionicons
                    name={muted ? 'volume-mute' : 'volume-high'}
                    size={18}
                    color="#F8FAFC"
                  />
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>

        {sourceUrl && watchLinkLabel ? (
          <Pressable
            onPress={openSourceUrl}
            accessibilityRole="link"
            accessibilityLabel={`${watchLinkLabel}, ${sourceUrl}`}
            style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}
          >
            <Text style={[styles.sourceLink, { color: tokens.color.accent }]}>
              {watchLinkLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 4,
  },
  center: {
    alignItems: 'center',
    gap: 10,
  },
  frame: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 6,
  },
  posterLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  posterScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  playerLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  webView: {
    flex: 1,
    backgroundColor: '#000',
  },
  chrome: {
    ...StyleSheet.absoluteFillObject,
    padding: 10,
    justifyContent: 'space-between',
  },
  platformPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  platformText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  chromeRight: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    gap: 8,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceLink: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 18,
    textDecorationLine: 'underline',
    paddingHorizontal: 4,
  },
});
