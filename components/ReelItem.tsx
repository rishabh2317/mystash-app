import { useThemeMode } from '@/contexts/ThemeContext';
import type { Product, Video } from '@/src/mocks/videos';
import { IMMERSIVE_TOKENS } from '@/src/theme/tokens';
import { feedThumbnailFadeMs } from '@/src/ui/feedA11y';
import { setFeedMuted, useFeedMuted } from '@/src/ui/feedAudioPreference';
import {
  creatorDisplayNameFromFeed,
  creatorUsernameFromFeed,
} from '@/src/ui/feedCreatorIdentity';
import type { CreatorMoreReelTarget } from '@/src/ui/collectionCreatorMore';
import type {
  FeedReelFollow,
  FeedReelLike,
  FeedReelSave,
  FeedReelShare,
} from '@/src/ui/feedReelTypes';
import { usePrefersReducedMotion } from '@/src/ui/usePrefersReducedMotion';
import React, { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
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
  like?: FeedReelLike | null;
  save?: FeedReelSave | null;
  share?: FeedReelShare | null;
  moreFromCreator?: CreatorMoreReelTarget | null;
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
  like,
  save,
  share,
  moreFromCreator,
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
          like={like}
          save={save}
          share={share}
          moreFromCreator={moreFromCreator}
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
          like={like}
          save={save}
          share={share}
          moreFromCreator={moreFromCreator}
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
  like,
  save,
  share,
  moreFromCreator,
  creatorAvatarUrl,
  creatorUsername,
  creatorDisplayName,
  onVolumeToggle,
  isMuted,
  playbackFailed,
  onPlaybackRetry,
  bottomChromeInset = 0,
}: {
  video: Video;
  media: React.ReactNode;
  onProductPress?: (product: Product) => void;
  follow?: FeedReelFollow | null;
  like?: FeedReelLike | null;
  save?: FeedReelSave | null;
  share?: FeedReelShare | null;
  moreFromCreator?: CreatorMoreReelTarget | null;
  creatorAvatarUrl?: string | null;
  creatorUsername?: string | null;
  creatorDisplayName?: string | null;
  onVolumeToggle?: () => void;
  isMuted?: boolean;
  playbackFailed?: boolean;
  onPlaybackRetry?: () => void;
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
      {playbackFailed ? (
        <View style={styles.recovery}>
          <Text style={styles.recoveryText}>This video could not play here.</Text>
          <View style={styles.recoveryActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Retry video" onPress={onPlaybackRetry} style={styles.recoveryButton}>
              <Text style={styles.recoveryText}>Retry</Text>
            </Pressable>
            <Pressable accessibilityRole="link" accessibilityLabel="Open video source" onPress={() => void Linking.openURL(video.url)} style={styles.recoveryButton}>
              <Text style={styles.recoveryText}>Open source</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      <ReelActionStack
        onVolumeToggle={onVolumeToggle}
        isMuted={isMuted}
        like={like}
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
        moreFromCreator={moreFromCreator}
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
  like,
  save,
  share,
  moreFromCreator,
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
  like?: FeedReelLike | null;
  save?: FeedReelSave | null;
  share?: FeedReelShare | null;
  moreFromCreator?: CreatorMoreReelTarget | null;
  creatorAvatarUrl?: string | null;
  creatorUsername?: string | null;
  creatorDisplayName?: string | null;
  bottomChromeInset?: number;
}) {
  const isMuted = useFeedMuted();
  const webViewRef = useRef<any>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!isActive || ready || playbackFailed) return;
    const timer = setTimeout(() => setPlaybackFailed(true), 14000);
    return () => clearTimeout(timer);
  }, [isActive, ready, playbackFailed, retryAttempt, video.id]);
  useEffect(() => { setReady(false); setPlaybackFailed(false); setRetryAttempt(0); }, [video.id]);
  const retryPlayback = () => { setReady(false); setPlaybackFailed(false); setRetryAttempt((n) => n + 1); };

  const toggleAudio = () => {
    const nextMuted = !isMuted;
    setFeedMuted(nextMuted);
    injectMuted(webViewRef, nextMuted);
  };

  return (
    <ReelStageShell
      video={originalVideo}
      media={
        <InstagramReelItem
          key={`${video.id}:${retryAttempt}`}
          video={video}
          isActive={isActive && !playbackFailed}
          webViewRef={webViewRef}
          fadeMs={fadeMs}
          isMuted={isMuted}
          onReady={() => { setReady(true); setPlaybackFailed(false); }}
          onLoadError={() => setPlaybackFailed(true)}
        />
      }
      onProductPress={onProductPress}
      follow={follow}
      like={like}
      save={save}
      share={share}
      moreFromCreator={moreFromCreator}
      creatorAvatarUrl={creatorAvatarUrl}
      creatorUsername={creatorUsername}
      creatorDisplayName={creatorDisplayName}
      onVolumeToggle={toggleAudio}
      isMuted={isMuted}
      playbackFailed={playbackFailed}
      onPlaybackRetry={retryPlayback}
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
  like,
  save,
  share,
  moreFromCreator,
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
  like?: FeedReelLike | null;
  save?: FeedReelSave | null;
  share?: FeedReelShare | null;
  moreFromCreator?: CreatorMoreReelTarget | null;
  creatorAvatarUrl?: string | null;
  creatorUsername?: string | null;
  creatorDisplayName?: string | null;
  bottomChromeInset?: number;
}) {
  const isMuted = useFeedMuted();
  const webViewRef = useRef<any>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!isActive || ready || playbackFailed) return;
    const timer = setTimeout(() => setPlaybackFailed(true), 14000);
    return () => clearTimeout(timer);
  }, [isActive, ready, playbackFailed, retryAttempt, video.id]);
  useEffect(() => { setReady(false); setPlaybackFailed(false); setRetryAttempt(0); }, [video.id]);
  const retryPlayback = () => { setReady(false); setPlaybackFailed(false); setRetryAttempt((n) => n + 1); };

  const toggleAudio = () => {
    const nextMuted = !isMuted;
    setFeedMuted(nextMuted);
    injectMuted(webViewRef, nextMuted);
  };

  return (
    <ReelStageShell
      video={originalVideo}
      media={<YouTubeReelItem key={`${video.id}:${retryAttempt}`} video={video} isActive={isActive && !playbackFailed} isMuted={isMuted} webViewRef={webViewRef} fadeMs={fadeMs} onReady={() => { setReady(true); setPlaybackFailed(false); }} onLoadError={() => setPlaybackFailed(true)} />}
      onProductPress={onProductPress}
      follow={follow}
      like={like}
      save={save}
      share={share}
      moreFromCreator={moreFromCreator}
      creatorAvatarUrl={creatorAvatarUrl}
      creatorUsername={creatorUsername}
      creatorDisplayName={creatorDisplayName}
      onVolumeToggle={toggleAudio}
      isMuted={isMuted}
      playbackFailed={playbackFailed}
      onPlaybackRetry={retryPlayback}
      bottomChromeInset={bottomChromeInset}
    />
  );
}

const styles = StyleSheet.create({
  recovery: { position: 'absolute', top: '38%', alignSelf: 'center', zIndex: 10, alignItems: 'center', gap: 10 },
  recoveryActions: { flexDirection: 'row', gap: 12 },
  recoveryButton: { minHeight: 44, minWidth: 96, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.65)' },
  recoveryText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
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
