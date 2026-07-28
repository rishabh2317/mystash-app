import { Video } from '@/src/mocks/videos';
import {
  buildYoutubeWebHtml,
  extractYoutubeVideoIdFromUrl,
  resolveYoutubeParentOrigin,
} from '@/src/utils/youtubeWebViewEmbed';
import { Image } from 'expo-image';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    StyleSheet,
    View
} from 'react-native';
import { WebView } from 'react-native-webview';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

interface YouTubeReelItemProps {
  video: Video;
  isActive: boolean;
  onBuyPress: (video: Video) => void;
  webViewRef?: React.RefObject<any>;
}

export default function YouTubeReelItem({ video, isActive, onBuyPress, webViewRef: externalWebViewRef }: YouTubeReelItemProps) {
  const [showWebView, setShowWebView] = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const internalWebViewRef = useRef<WebView>(null);
  
  // Use external ref if provided, otherwise use internal ref
  const webViewRef = externalWebViewRef || internalWebViewRef;

  useEffect(() => {
    if (isActive && video.embed_url) {
      // Fade out thumbnail, then show webview
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        setShowWebView(true);
        // Fade in webview
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
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
  }, [isActive, video.embed_url]);

  const parentOrigin = useMemo(() => resolveYoutubeParentOrigin(), []);
  const videoId = video.embed_url ? extractYoutubeVideoIdFromUrl(video.embed_url) : null;
  const youtubeHtml = useMemo(
    () =>
      videoId && video.embed_url
        ? buildYoutubeWebHtml(videoId, parentOrigin)
        : '<!DOCTYPE html><html><body style="background:#000"></body></html>',
    [videoId, video.embed_url, parentOrigin],
  );

  return (
    <View style={styles.container}>
      {/* Video/Thumbnail Container */}
      <View style={styles.videoContainer}>
        {/* Static Thumbnail */}
        <Animated.View style={[styles.thumbnailContainer, { opacity: showWebView ? 0 : fadeAnim }]}>
          <Image
            source={{ uri: video.thumbnail }}
            style={styles.thumbnail}
            contentFit="cover"
            priority="high"
            cachePolicy="memory-disk"
          />
        </Animated.View>

        {/* WebView for YouTube Embed - Only shown when active */}
        {isActive && video.embed_url && showWebView && videoId && (
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
              onMessage={(event) => {
                if (__DEV__ && event.nativeEvent.data === 'videoReady') {
                  console.log('YouTube player ready');
                }
              }}
            />
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    backgroundColor: 'black',
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
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  contentContainer: {
    position: 'absolute',
    bottom: 80,
    left: 20,
    right: 20,
  },
  productInfo: {
    marginBottom: 20,
  },
  productName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 8,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },
  creatorName: {
    fontSize: 16,
    color: 'white',
    marginBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },
  stashScore: {
    fontSize: 14,
    color: 'white',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },
  buyButton: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 25,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  buyButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  audioButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  audioButtonText: {
    fontSize: 20,
    color: 'white',
  },
  headerMask: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 80, // Cover YouTube title bar/IG profile
    zIndex: 10, // Higher than WebView
  },
  footerMask: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SCREEN_HEIGHT * 0.2, // 20% of screen height
    backgroundColor: 'rgba(0,0,0,0.95)', // Opaque to hide footers
    zIndex: 10, // Higher than WebView
  },
  stashScoreContainer: {
    position: 'absolute',
    top: 40, // Centered in header
    right: 20,
  },
});
