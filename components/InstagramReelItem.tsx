import { Video } from '@/src/mocks/videos';
import { IMMERSIVE_TOKENS } from '@/src/theme/tokens';
import {
  FEED_WEBVIEW_UA_ANDROID,
  FEED_WEBVIEW_UA_IOS,
  createPlaybackTrace,
  notePlayerMounted,
  notePlayerReleased,
  playbackPlayerCount,
  playbackLogLine,
  recordPlaybackMark,
  shouldRevealFeedFrame,
  type PlaybackTrace,
} from '@/src/ui/feedPlaybackTiming';
import { buildInstagramEmbedHtml } from '@/src/utils/instagramWebViewEmbed';
import { Image } from 'expo-image';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

interface InstagramReelItemProps {
  video: Video;
  isActive: boolean;
  fadeMs?: number;
  webViewRef?: React.RefObject<any>;
}

function logPlayback(trace: PlaybackTrace, event: Parameters<typeof playbackLogLine>[1], mounted: number) {
  if (!__DEV__) return;
  console.log('[Mystash:Playback]', playbackLogLine(trace, event, mounted));
}

export default function InstagramReelItem({
  video,
  isActive,
  fadeMs: _fadeMs = 300,
  webViewRef: externalWebViewRef,
}: InstagramReelItemProps) {
  const [revealedUrl, setRevealedUrl] = useState<string | null>(null);
  const internalWebViewRef = useRef<WebView>(null);
  const webViewRef = externalWebViewRef || internalWebViewRef;
  const traceRef = useRef<PlaybackTrace | null>(null);
  const embedUrl = video.embed_url?.trim() || '';
  const mountPlayer = Boolean(isActive && embedUrl);
  const revealed = mountPlayer && revealedUrl === embedUrl;

  useEffect(() => {
    if (!mountPlayer) return;
    const trace = createPlaybackTrace('instagram', embedUrl);
    recordPlaybackMark(trace, 'active');
    recordPlaybackMark(trace, 'mount');
    traceRef.current = trace;
    logPlayback(trace, 'mount', notePlayerMounted());
    return () => {
      recordPlaybackMark(trace, 'release');
      logPlayback(trace, 'release', notePlayerReleased());
      if (traceRef.current === trace) traceRef.current = null;
    };
  }, [embedUrl, mountPlayer]);

  return (
    <View style={styles.container}>
      <View style={styles.videoContainer}>
        {mountPlayer ? (
          <View style={styles.webViewContainer}>
            <WebView
              ref={webViewRef}
              source={{
                html: buildInstagramEmbedHtml(embedUrl),
                baseUrl: 'https://www.instagram.com',
              }}
              style={styles.webView}
              originWhitelist={['*']}
              javaScriptEnabled
              domStorageEnabled
              cacheEnabled
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              allowsFullscreenVideo
              scrollEnabled={false}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              bounces={false}
              androidLayerType="hardware"
              userAgent={Platform.OS === 'android' ? FEED_WEBVIEW_UA_ANDROID : FEED_WEBVIEW_UA_IOS}
              onLoadStart={() => {
                const trace = traceRef.current;
                if (!trace) return;
                recordPlaybackMark(trace, 'loadStart');
                logPlayback(trace, 'loadStart', playbackPlayerCount());
              }}
              onLoadEnd={() => {
                const trace = traceRef.current;
                if (!trace) return;
                recordPlaybackMark(trace, 'loadEnd');
                logPlayback(trace, 'loadEnd', playbackPlayerCount());
              }}
              onMessage={(event) => {
                const message = event.nativeEvent.data;
                const trace = traceRef.current;
                if (!trace) return;
                if (message === 'playerVisible') {
                  logPlayback(trace, 'playerVisible', playbackPlayerCount());
                  setRevealedUrl(embedUrl);
                }
                if (shouldRevealFeedFrame(message)) {
                  recordPlaybackMark(trace, 'firstFrame');
                  logPlayback(trace, 'firstFrame', playbackPlayerCount());
                  setRevealedUrl(embedUrl);
                }
              }}
              onError={(error) => {
                if (__DEV__) console.warn('Instagram WebView:', error.nativeEvent);
              }}
            />
          </View>
        ) : null}
        <View
          pointerEvents="none"
          style={[styles.thumbnailContainer, { opacity: revealed ? 0 : 1 }]}
        >
          <Image
            source={{ uri: video.thumbnail }}
            style={styles.thumbnail}
            contentFit="cover"
            priority="high"
            cachePolicy="memory-disk"
          />
        </View>
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
    zIndex: 2,
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
    backgroundColor: IMMERSIVE_TOKENS.stage,
  },
});
