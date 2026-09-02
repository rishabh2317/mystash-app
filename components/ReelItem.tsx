import { ThemedText } from '@/components/themed-text';
import { useThemeMode } from '@/contexts/ThemeContext';
import type { Product, Video } from '@/src/mocks/videos';
import { feedThumbnailFadeMs } from '@/src/ui/feedA11y';
import { usePrefersReducedMotion } from '@/src/ui/usePrefersReducedMotion';
import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { getVideoUrlInfo, transformToEmbedUrl } from '../src/utils/videoUtils';
import BottomDock, {
  type BottomDockFollow,
  type BottomDockSave,
  type BottomDockShare,
} from './BottomDock';
import { ReelActionStack } from './feed/ReelActionStack';
import InstagramReelItem from './InstagramReelItem';
import YouTubeReelItem from './YouTubeReelItem';

interface ReelItemProps {
  video: Video;
  isActive: boolean;
  onProductPress?: (product: Product) => void;
  follow?: BottomDockFollow | null;
  save?: BottomDockSave | null;
  share?: BottomDockShare | null;
  creatorAvatarUrl?: string | null;
  creatorUsername?: string | null;
  creatorDisplayName?: string | null;
}

export default function ReelItem({
  video,
  isActive,
  onProductPress,
  follow,
  save,
  share,
  creatorAvatarUrl,
  creatorUsername,
  creatorDisplayName,
}: ReelItemProps) {
  const { tokens } = useThemeMode();
  const reduceMotion = usePrefersReducedMotion();
  const fadeMs = feedThumbnailFadeMs({
    reduceMotion,
    normalMs: tokens.motion.thumbnailFadeMs,
    reducedMs: tokens.motion.thumbnailFadeReducedMs,
  });
  let transformedVideo = { ...video };

  if (video.url) {
    if (!video.embed_url) {
      const embedUrl = transformToEmbedUrl(video.url);
      if (embedUrl) {
        transformedVideo.embed_url = embedUrl;
      }
    } else {
      transformedVideo.embed_url = video.embed_url;
    }

    const urlInfo = getVideoUrlInfo(video.url);

    if (!urlInfo.isValid) {
      return (
        <View style={[styles.stage, { backgroundColor: tokens.color.canvas }]}>
          <View style={styles.fallback}>
            <ThemedText style={styles.fallbackText}>Invalid Video Source</ThemedText>
            <ThemedText style={styles.fallbackSubtext}>This video cannot be displayed</ThemedText>
          </View>
        </View>
      );
    }

    if (urlInfo.platform === 'youtube') {
      return (
        <YouTubeReelStage
          video={transformedVideo}
          originalVideo={video}
          isActive={isActive}
          fadeMs={fadeMs}
          onProductPress={onProductPress}
          follow={follow}
          save={save}
          share={share}
          creatorAvatarUrl={creatorAvatarUrl}
          creatorUsername={creatorUsername}
          creatorDisplayName={creatorDisplayName}
        />
      );
    }

    if (urlInfo.platform === 'instagram') {
      return (
        <ReelStageShell
          video={video}
          media={<InstagramReelItem video={transformedVideo} isActive={isActive} fadeMs={fadeMs} />}
          onProductPress={onProductPress}
          follow={follow}
          save={save}
          share={share}
          creatorAvatarUrl={creatorAvatarUrl}
          creatorUsername={creatorUsername}
          creatorDisplayName={creatorDisplayName}
        />
      );
    }
  }

  return (
    <View style={[styles.stage, { backgroundColor: tokens.color.canvas }]}>
      <View style={styles.fallback}>
        <ThemedText style={styles.fallbackText}>Unsupported Platform</ThemedText>
        <ThemedText style={styles.fallbackSubtext}>This video platform is not yet supported</ThemedText>
      </View>
    </View>
  );
}

function ReelStageShell({
  video,
  media,
  onProductPress,
  follow,
  save,
  share,
  creatorAvatarUrl,
  creatorUsername,
  creatorDisplayName,
  onVolumeToggle,
  isMuted,
}: {
  video: Video;
  media: React.ReactNode;
  onProductPress?: (product: Product) => void;
  follow?: BottomDockFollow | null;
  save?: BottomDockSave | null;
  share?: BottomDockShare | null;
  creatorAvatarUrl?: string | null;
  creatorUsername?: string | null;
  creatorDisplayName?: string | null;
  onVolumeToggle?: () => void;
  isMuted?: boolean;
}) {
  const { tokens } = useThemeMode();
  const [dockHeight, setDockHeight] = useState(160);
  /** Align stack with dock title-row band (top of dock overlay). */
  const actionBottom = Math.max(dockHeight - 52, 96);

  return (
    <View style={[styles.stage, { backgroundColor: tokens.color.canvas }]}>
      {media}
      <ReelActionStack
        onVolumeToggle={onVolumeToggle}
        isMuted={isMuted}
        save={save}
        share={share}
        bottomOffset={actionBottom}
      />
      <BottomDock
        video={video}
        onProductPress={onProductPress}
        follow={follow}
        creatorAvatarUrl={creatorAvatarUrl}
        creatorUsername={creatorUsername}
        creatorDisplayName={creatorDisplayName}
        onDockHeightChange={setDockHeight}
      />
    </View>
  );
}

function YouTubeReelStage({
  video,
  originalVideo,
  isActive,
  fadeMs,
  onProductPress,
  follow,
  save,
  share,
  creatorAvatarUrl,
  creatorUsername,
  creatorDisplayName,
}: {
  video: Video;
  originalVideo: Video;
  isActive: boolean;
  fadeMs: number;
  onProductPress?: (product: Product) => void;
  follow?: BottomDockFollow | null;
  save?: BottomDockSave | null;
  share?: BottomDockShare | null;
  creatorAvatarUrl?: string | null;
  creatorUsername?: string | null;
  creatorDisplayName?: string | null;
}) {
  const [isMuted, setIsMuted] = useState(true);
  const webViewRef = useRef<any>(null);

  const toggleAudio = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`
        (function() {
          try {
            if (typeof window.__mystashSetMuted === 'function') {
              window.__mystashSetMuted(${nextMuted});
            } else {
              window.__mystashPendingMuted = ${nextMuted};
            }
          } catch (e) {}
          true;
        })();
      `);
    }
  };

  return (
    <ReelStageShell
      video={originalVideo}
      media={<YouTubeReelItem video={video} isActive={isActive} webViewRef={webViewRef} fadeMs={fadeMs} />}
      onProductPress={onProductPress}
      follow={follow}
      save={save}
      share={share}
      creatorAvatarUrl={creatorAvatarUrl}
      creatorUsername={creatorUsername}
      creatorDisplayName={creatorDisplayName}
      onVolumeToggle={toggleAudio}
      isMuted={isMuted}
    />
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  fallback: {
    ...StyleSheet.absoluteFillObject,
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
});
