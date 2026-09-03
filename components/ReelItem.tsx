import { useThemeMode } from '@/contexts/ThemeContext';
import type { Product, Video } from '@/src/mocks/videos';
import { IMMERSIVE_TOKENS } from '@/src/theme/tokens';
import { feedThumbnailFadeMs } from '@/src/ui/feedA11y';
import {
  creatorDisplayNameFromFeed,
  creatorUsernameFromFeed,
} from '@/src/ui/feedCreatorIdentity';
import type { FeedReelFollow, FeedReelSave, FeedReelShare } from '@/src/ui/feedReelTypes';
import { usePrefersReducedMotion } from '@/src/ui/usePrefersReducedMotion';
import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getVideoUrlInfo, transformToEmbedUrl } from '../src/utils/videoUtils';
import { FeedReelOverlay } from './feed/FeedReelOverlay';
import { ReelActionStack } from './feed/ReelActionStack';
import InstagramReelItem from './InstagramReelItem';
import YouTubeReelItem from './YouTubeReelItem';

/** Overlay height before first layout; replaced by the measured value. */
const REEL_OVERLAY_HEIGHT_ESTIMATE = 180;
/** Floor so the action rail clears the dock on reels with no product shelf. */
const REEL_ACTION_RAIL_MIN_BOTTOM = 96;

interface ReelItemProps {
  video: Video;
  isActive: boolean;
  onProductPress?: (product: Product) => void;
  follow?: FeedReelFollow | null;
  save?: FeedReelSave | null;
  share?: FeedReelShare | null;
  creatorAvatarUrl?: string | null;
  creatorUsername?: string | null;
  creatorDisplayName?: string | null;
  /** Home tab: lift dock above absolute tab bar. */
  bottomChromeInset?: number;
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
  bottomChromeInset = 0,
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
        <ReelStageFallback
          title="Invalid Video Source"
          message="This video cannot be displayed"
        />
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
          bottomChromeInset={bottomChromeInset}
        />
      );
    }

    if (urlInfo.platform === 'instagram') {
      return (
        <InstagramReelStage
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
          bottomChromeInset={bottomChromeInset}
        />
      );
    }
  }

  return (
    <ReelStageFallback
      title="Unsupported Platform"
      message="This video platform is not yet supported"
    />
  );
}

/** Non-media reel state: page canvas + page text tokens, not the media stage. */
function ReelStageFallback({ title, message }: { title: string; message: string }) {
  const { tokens } = useThemeMode();
  return (
    <View style={[styles.stage, { backgroundColor: tokens.color.canvas }]}>
      <View style={[styles.fallback, { padding: tokens.space.lg, gap: tokens.space.xs }]}>
        <Text
          style={[
            styles.fallbackText,
            {
              color: tokens.color.text,
              fontSize: tokens.fontSize.title,
              fontWeight: tokens.fontWeight.bold,
            },
          ]}
        >
          {title}
        </Text>
        <Text
          style={[
            styles.fallbackSubtext,
            { color: tokens.color.textMuted, fontSize: tokens.fontSize.bodyStrong },
          ]}
        >
          {message}
        </Text>
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
  bottomChromeInset = 0,
}: {
  video: Video;
  media: React.ReactNode;
  onProductPress?: (product: Product) => void;
  follow?: FeedReelFollow | null;
  save?: FeedReelSave | null;
  share?: FeedReelShare | null;
  creatorAvatarUrl?: string | null;
  creatorUsername?: string | null;
  creatorDisplayName?: string | null;
  onVolumeToggle?: () => void;
  isMuted?: boolean;
  bottomChromeInset?: number;
}) {
  const { tokens } = useThemeMode();
  const [overlayHeight, setOverlayHeight] = useState(REEL_OVERLAY_HEIGHT_ESTIMATE);
  const username = creatorUsername ?? creatorUsernameFromFeed(video);
  const displayName = creatorDisplayName ?? creatorDisplayNameFromFeed(video);
  /** Float action rail above the bottom overlay (creator + product shelf). */
  const actionBottom = Math.max(
    overlayHeight + tokens.space.sm,
    REEL_ACTION_RAIL_MIN_BOTTOM,
  );

  return (
    <View style={styles.stage}>
      {media}
      <ReelActionStack
        onVolumeToggle={onVolumeToggle}
        isMuted={isMuted}
        save={save}
        share={share}
        bottomOffset={actionBottom}
      />
      <FeedReelOverlay
        video={video}
        displayName={displayName}
        username={username}
        avatarUrl={creatorAvatarUrl}
        follow={follow}
        onProductPress={onProductPress}
        onOverlayHeightChange={setOverlayHeight}
        bottomChromeInset={bottomChromeInset}
      />
    </View>
  );
}

function injectMuted(webViewRef: React.RefObject<any>, nextMuted: boolean) {
  webViewRef.current?.injectJavaScript(`
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

function InstagramReelStage({
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
  bottomChromeInset = 0,
}: {
  video: Video;
  originalVideo: Video;
  isActive: boolean;
  fadeMs: number;
  onProductPress?: (product: Product) => void;
  follow?: FeedReelFollow | null;
  save?: FeedReelSave | null;
  share?: FeedReelShare | null;
  creatorAvatarUrl?: string | null;
  creatorUsername?: string | null;
  creatorDisplayName?: string | null;
  bottomChromeInset?: number;
}) {
  const [isMuted, setIsMuted] = useState(true);
  const webViewRef = useRef<any>(null);

  const toggleAudio = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    injectMuted(webViewRef, nextMuted);
  };

  return (
    <ReelStageShell
      video={originalVideo}
      media={
        <InstagramReelItem
          video={video}
          isActive={isActive}
          webViewRef={webViewRef}
          fadeMs={fadeMs}
        />
      }
      onProductPress={onProductPress}
      follow={follow}
      save={save}
      share={share}
      creatorAvatarUrl={creatorAvatarUrl}
      creatorUsername={creatorUsername}
      creatorDisplayName={creatorDisplayName}
      onVolumeToggle={toggleAudio}
      isMuted={isMuted}
      bottomChromeInset={bottomChromeInset}
    />
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
  bottomChromeInset = 0,
}: {
  video: Video;
  originalVideo: Video;
  isActive: boolean;
  fadeMs: number;
  onProductPress?: (product: Product) => void;
  follow?: FeedReelFollow | null;
  save?: FeedReelSave | null;
  share?: FeedReelShare | null;
  creatorAvatarUrl?: string | null;
  creatorUsername?: string | null;
  creatorDisplayName?: string | null;
  bottomChromeInset?: number;
}) {
  const [isMuted, setIsMuted] = useState(true);
  const webViewRef = useRef<any>(null);

  const toggleAudio = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    injectMuted(webViewRef, nextMuted);
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
      bottomChromeInset={bottomChromeInset}
    />
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: IMMERSIVE_TOKENS.stage,
  },
  fallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackText: {
    textAlign: 'center',
  },
  fallbackSubtext: {
    textAlign: 'center',
  },
});
