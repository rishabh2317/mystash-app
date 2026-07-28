import { Video } from '@/src/mocks/videos';
import { buildInstagramEmbedHtml } from '@/src/utils/instagramWebViewEmbed';
import { Image } from 'expo-image';
import React, { useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    StyleSheet,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

interface InstagramReelItemProps {
  video: Video;
  isActive: boolean;
  onBuyPress: (video: Video) => void;
}

export default function InstagramReelItem({ video, isActive, onBuyPress }: InstagramReelItemProps) {
  const insets = useSafeAreaInsets();
  const [showWebView, setShowWebView] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const webViewRef = useRef<WebView>(null);

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

  const toggleAudio = () => {
    const newMutedState = !isMuted;
    setIsMuted(newMutedState);
    
    // Instagram doesn't support programmatic audio control
    console.log('Instagram audio toggle requested:', newMutedState ? 'mute' : 'unmute');
  };

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

        {/* WebView for Instagram Embed - Only shown when active */}
        {isActive && video.embed_url && showWebView && (
          <Animated.View style={[styles.webViewContainer, { opacity: fadeAnim }]}>
            <WebView
              ref={webViewRef}
              source={{ 
                html: buildInstagramEmbedHtml(video.embed_url),
                baseUrl: 'https://www.instagram.com'
              }}
              style={styles.webView}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              allowsInlineMediaPlayback={true}
              mediaPlaybackRequiresUserAction={false}
              allowsFullscreenVideo={true}
              scrollEnabled={false}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              bounces={false}
              androidLayerType="hardware"
              userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
              onError={(error) => console.error('Instagram WebView Error:', error)}
              onLoad={() => console.log('Instagram WebView loaded for:', video.product_name)}
              onMessage={(event) => {
                if (event.nativeEvent.data === 'videoReady') {
                  console.log('Instagram video ready for interaction');
                } else if (event.nativeEvent.data === 'pause') {
                  console.log('Instagram video paused for:', video.product_name);
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
    height: 80, 
    zIndex: 10, 
  },
  footerMask: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SCREEN_HEIGHT * 0.2, 
    backgroundColor: 'rgba(0,0,0,0.95)', 
    zIndex: 10, 
  },
  stashScoreContainer: {
    position: 'absolute',
    top: 40, 
    right: 20,
  },
});
