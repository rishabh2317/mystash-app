import { ThemedText } from '@/components/themed-text';
import { Video } from '@/src/mocks/videos';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { getVideoUrlInfo, transformToEmbedUrl } from '../src/utils/videoUtils';
import Header from './Header';
import BottomDock from './BottomDock';
import InstagramReelItem from './InstagramReelItem';
import YouTubeReelItem from './YouTubeReelItem';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

interface ReelItemProps {
  video: Video;
  isActive: boolean;
  onBuyPress: (video: Video) => void;
}

export default function ReelItem({ video, isActive, onBuyPress }: ReelItemProps) {
  const router = useRouter();
  
  // Validate and transform the video URL
  let transformedVideo = { ...video };
  
  if (video.url) {
    // Use existing embed_url if available, otherwise transform the original URL
    if (!video.embed_url) {
      const embedUrl = transformToEmbedUrl(video.url);
      if (embedUrl) {
        transformedVideo.embed_url = embedUrl;
      }
    } else {
      // Use the existing embed_url directly
      transformedVideo.embed_url = video.embed_url;
    }
    
    // Validate the video URL
    const urlInfo = getVideoUrlInfo(video.url);
    
    if (!urlInfo.isValid) {
      // Invalid video source fallback UI
      return (
        <View style={styles.container}>
          <View style={styles.fallbackContainer}>
            <ThemedText style={styles.fallbackText}>Invalid Video Source</ThemedText>
            <ThemedText style={styles.fallbackSubtext}>This video cannot be displayed</ThemedText>
          </View>
        </View>
      );
    }
    
    // Render platform-specific component with Product Dock
    if (urlInfo.platform === 'youtube') {
      return (
        <YouTubeReelItemWrapper 
          video={transformedVideo} 
          originalVideo={video}
          isActive={isActive} 
          onBuyPress={onBuyPress} 
          router={router}
        />
      );
    }
    
    if (urlInfo.platform === 'instagram') {
      return (
        <View style={styles.container}>
          <LinearGradient
            colors={['#05070A', '#0A0E14', '#05070A']}
            locations={[0, 0.5, 1]}
            style={styles.radialGradient}
          />
          <InstagramReelItem video={transformedVideo} isActive={isActive} onBuyPress={onBuyPress} />
          <Header />
          <BottomDock video={video} router={router} />
        </View>
      );
    }
  }
  
  // Unsupported platform fallback UI
  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#05070A', '#0A0E14', '#05070A']}
        locations={[0, 0.5, 1]}
        style={styles.radialGradient}
      />
      <View style={styles.fallbackContainer}>
        <ThemedText style={styles.fallbackText}>Unsupported Platform</ThemedText>
        <ThemedText style={styles.fallbackSubtext}>This video platform is not yet supported</ThemedText>
      </View>
    </View>
  );
}

interface YouTubeReelItemWrapperProps {
  video: Video;
  originalVideo: Video;
  isActive: boolean;
  onBuyPress: (video: Video) => void;
  router: any;
}

function YouTubeReelItemWrapper({ video, originalVideo, isActive, onBuyPress, router }: YouTubeReelItemWrapperProps) {
  const [isMuted, setIsMuted] = useState(true);
  const webViewRef = useRef<any>(null);

  const toggleAudio = () => {
    const newMutedState = !isMuted;
    setIsMuted(newMutedState);
    
    // Route all audio control through a single bridge function inside the WebView.
    if (webViewRef.current) {
      const setMutedJS = `
        (function() {
          try {
            if (typeof window.__mystashSetMuted === 'function') {
              window.__mystashSetMuted(${newMutedState});
            } else {
              window.__mystashPendingMuted = ${newMutedState};
            }
          } catch (e) {}
          true;
        })();
      `;
      webViewRef.current.injectJavaScript(setMutedJS);
    }
  };

  return (
    <View style={styles.container}>
      <YouTubeReelItem video={video} isActive={isActive} onBuyPress={onBuyPress} webViewRef={webViewRef} />
      <Header />
      <BottomDock 
        video={originalVideo} 
        router={router} 
        onVolumeToggle={toggleAudio}
        isMuted={isMuted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    backgroundColor: '#0A0E14',
    position: 'relative',
  },
  radialGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.8,
  },
  fallbackContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  fallbackText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 8,
    textAlign: 'center',
  },
  fallbackSubtext: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
  fallbackTitle: {
    color: 'white',
    textAlign: 'center',
    fontSize: 16,
    marginBottom: 10,
    fontWeight: 'bold',
  },
  fallbackMessage: {
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    fontSize: 12,
  },
});
