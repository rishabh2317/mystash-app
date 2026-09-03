import { Video } from '@/src/mocks/videos';
import { IMMERSIVE_TOKENS } from '@/src/theme/tokens';
import { buildInstagramEmbedHtml } from '@/src/utils/instagramWebViewEmbed';
import { Image } from 'expo-image';
import React, { useEffect, useRef, useState } from 'react';
import {
    Animated,
    StyleSheet,
    View,
} from 'react-native';
import { WebView } from 'react-native-webview';

interface InstagramReelItemProps {
  video: Video;
  isActive: boolean;
  fadeMs?: number;
  webViewRef?: React.RefObject<any>;
}

export default function InstagramReelItem({
  video,
  isActive,
  fadeMs = 300,
  webViewRef: externalWebViewRef,
}: InstagramReelItemProps) {
  const [showWebView, setShowWebView] = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const internalWebViewRef = useRef<WebView>(null);
  const webViewRef = externalWebViewRef || internalWebViewRef;

  useEffect(() => {
    if (isActive && video.embed_url) {
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
  }, [fadeAnim, fadeMs, isActive, video.embed_url]);

  return (
    <View style={styles.container}>
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

        {isActive && video.embed_url && showWebView ? (
          <Animated.View style={[styles.webViewContainer, { opacity: fadeAnim }]}>
            <WebView
              ref={webViewRef}
              source={{
                html: buildInstagramEmbedHtml(video.embed_url),
                baseUrl: 'https://www.instagram.com',
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
              injectedJavaScript={`
                (function() {
                  try {
                    if (typeof window.__mystashKickPlayback === 'function') {
                      window.__mystashKickPlayback();
                    }
                  } catch (e) {}
                  true;
                })();
              `}
              userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
              onError={(error) => {
                if (__DEV__) console.warn('Instagram WebView:', error.nativeEvent);
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
