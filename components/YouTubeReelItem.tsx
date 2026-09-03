import { Video } from '@/src/mocks/videos';
import { IMMERSIVE_TOKENS } from '@/src/theme/tokens';
import {
  buildYoutubeWebHtml,
  extractYoutubeVideoIdFromUrl,
  resolveYoutubeParentOrigin,
} from '@/src/utils/youtubeWebViewEmbed';
import { youtubeStageCropScale } from '@/src/ui/feedYoutubeCrop';
import { Image } from 'expo-image';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Animated,
    StyleSheet,
    View,
} from 'react-native';
import { WebView } from 'react-native-webview';

interface YouTubeReelItemProps {
  video: Video;
  isActive: boolean;
  webViewRef?: React.RefObject<any>;
  fadeMs?: number;
}

export default function YouTubeReelItem({
  video,
  isActive,
  webViewRef: externalWebViewRef,
  fadeMs = 300,
}: YouTubeReelItemProps) {
  const [showWebView, setShowWebView] = useState(false);
  const [stageHeight, setStageHeight] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const internalWebViewRef = useRef<WebView>(null);
  const webViewRef = externalWebViewRef || internalWebViewRef;

  useEffect(() => {
    if (isActive && video.embed_url && stageHeight > 0) {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: fadeMs,
        useNativeDriver: true,
      }).start(() => {
        setShowWebView(true);
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: fadeMs,
          useNativeDriver: true,
        }).start();
      });
    } else {
      setShowWebView(false);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 0,
        useNativeDriver: true,
      }).start();
    }
  }, [fadeAnim, fadeMs, isActive, stageHeight, video.embed_url]);

  const parentOrigin = useMemo(() => resolveYoutubeParentOrigin(), []);
  const videoId = video.embed_url ? extractYoutubeVideoIdFromUrl(video.embed_url) : null;
  const cropScale = youtubeStageCropScale(stageHeight);
  const youtubeHtml = useMemo(
    () =>
      videoId && video.embed_url
        ? buildYoutubeWebHtml(videoId, parentOrigin, cropScale)
        : '<!DOCTYPE html><html><body style="background:#000"></body></html>',
    [cropScale, parentOrigin, video.embed_url, videoId],
  );

  return (
    <View
      style={styles.container}
      onLayout={(event) => {
        const next = Math.round(event.nativeEvent.layout.height);
        if (next > 0 && stageHeight === 0) setStageHeight(next);
      }}
    >
      <View style={styles.videoContainer}>
        <Animated.View style={[styles.thumbnailContainer, { opacity: showWebView ? 0 : fadeAnim }]}>
          <Image
            source={{ uri: video.thumbnail }}
            style={styles.thumbnail}
            contentFit="cover"
            priority="high"
            cachePolicy="memory-disk"
          />
        </Animated.View>

        {isActive && video.embed_url && showWebView && videoId ? (
          <Animated.View style={[styles.webViewContainer, { opacity: fadeAnim }]}>
            <WebView
              ref={webViewRef}
              source={{
                html: youtubeHtml,
                baseUrl: `${parentOrigin}/`,
              }}
              style={styles.webView}
              originWhitelist={['*']}
              javaScriptEnabled
              domStorageEnabled
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              allowsFullscreenVideo
              scrollEnabled={false}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              bounces={false}
              androidLayerType="hardware"
              userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
              onError={(error) => {
                if (__DEV__) console.warn('YouTube WebView:', error.nativeEvent);
              }}
            />
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    flex: 1,
    backgroundColor: IMMERSIVE_TOKENS.stage,
  },
  videoContainer: {
    flex: 1,
    position: 'relative',
  },
  thumbnailContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  webViewContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  webView: {
    width: '100%',
    height: '100%',
  },
});
