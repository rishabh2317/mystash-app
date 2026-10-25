import { Video } from '@/src/mocks/videos';
import { IMMERSIVE_TOKENS } from '@/src/theme/tokens';
import { youtubeStageCropScale } from '@/src/ui/feedYoutubeCrop';
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
  shouldRevealYoutubePoster,
  type PlaybackTrace,
} from '@/src/ui/feedPlaybackTiming';
import {
  buildYoutubeWebHtml,
  extractYoutubeVideoIdFromUrl,
  resolveYoutubeParentOrigin,
  youtubeCropScript,
} from '@/src/utils/youtubeWebViewEmbed';
import { Image } from 'expo-image';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

interface YouTubeReelItemProps {
  video: Video;
  isActive: boolean;
  webViewRef?: React.RefObject<any>;
  fadeMs?: number;
}

function logPlayback(trace: PlaybackTrace, event: Parameters<typeof playbackLogLine>[1], mounted: number) {
  if (!__DEV__) return;
  console.log('[Mystash:Playback]', playbackLogLine(trace, event, mounted));
}

export default function YouTubeReelItem({
  video,
  isActive,
  webViewRef: externalWebViewRef,
  fadeMs: _fadeMs = 300,
}: YouTubeReelItemProps) {
  const [stageHeight, setStageHeight] = useState(0);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const internalWebViewRef = useRef<WebView>(null);
  const webViewRef = externalWebViewRef || internalWebViewRef;
  const traceRef = useRef<PlaybackTrace | null>(null);
  const stageHeightRef = useRef(0);

  const parentOrigin = useMemo(() => resolveYoutubeParentOrigin(), []);
  const videoId = video.embed_url ? extractYoutubeVideoIdFromUrl(video.embed_url) : null;
  const mountPlayer = Boolean(isActive && video.embed_url && videoId);
  const revealed = mountPlayer && revealedId === videoId;

  const youtubeHtml = useMemo(
    () =>
      videoId
        ? buildYoutubeWebHtml(videoId, parentOrigin, youtubeStageCropScale(0))
        : '<!DOCTYPE html><html><body style="background:#000"></body></html>',
    [parentOrigin, videoId],
  );

  const applyCrop = () => {
    const scale = youtubeStageCropScale(stageHeightRef.current);
    webViewRef.current?.injectJavaScript(youtubeCropScript(scale));
  };

  useEffect(() => {
    if (!mountPlayer || !videoId) return;
    const trace = createPlaybackTrace('youtube', videoId);
    recordPlaybackMark(trace, 'active');
    recordPlaybackMark(trace, 'mount');
    traceRef.current = trace;
    const mounted = notePlayerMounted();
    logPlayback(trace, 'mount', mounted);
    return () => {
      recordPlaybackMark(trace, 'release');
      logPlayback(trace, 'release', notePlayerReleased());
      if (traceRef.current === trace) traceRef.current = null;
    };
  }, [mountPlayer, videoId]);

  useEffect(() => {
    if (!mountPlayer || stageHeight <= 0) return;
    applyCrop();
  }, [mountPlayer, stageHeight]);

  return (
    <View
      style={styles.container}
      onLayout={(event) => {
        const next = Math.round(event.nativeEvent.layout.height);
        if (next > 0 && stageHeightRef.current === 0) {
          stageHeightRef.current = next;
          setStageHeight(next);
        }
      }}
    >
      <View style={styles.videoContainer}>
        {mountPlayer && videoId ? (
          <View style={styles.webViewContainer}>
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
                if (trace) {
                  recordPlaybackMark(trace, 'loadEnd');
                  logPlayback(trace, 'loadEnd', playbackPlayerCount());
                }
                applyCrop();
              }}
              onMessage={(event) => {
                const message = event.nativeEvent.data;
                const trace = traceRef.current;
                if (!trace || !videoId) return;
                if (message === 'iframeLoaded') {
                  recordPlaybackMark(trace, 'iframeLoaded');
                  logPlayback(trace, 'iframeLoaded', playbackPlayerCount());
                  applyCrop();
                }
                if (shouldRevealYoutubePoster(message)) {
                  setRevealedId(videoId);
                }
                if (shouldRevealFeedFrame(message)) {
                  recordPlaybackMark(trace, 'firstFrame');
                  logPlayback(trace, 'firstFrame', playbackPlayerCount());
                }
              }}
              onError={(error) => {
                if (__DEV__) console.warn('YouTube WebView:', error.nativeEvent);
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
