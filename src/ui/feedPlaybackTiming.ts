/** Watch playback timings. Dev logs only; no feed or product behavior. */

export const FEED_VIEWABILITY_HOLD_MS = 300;

export const FEED_WEBVIEW_UA_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

/** Honest Chrome UA. An iPhone UA on Android WebView sends YouTube down the iOS player path. */
export const FEED_WEBVIEW_UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

export type PlaybackPlatform = 'youtube' | 'instagram';

export type PlaybackMark = 'active' | 'mount' | 'loadStart' | 'loadEnd' | 'iframeLoaded' | 'firstFrame' | 'release';

export type PlaybackTrace = {
  platform: PlaybackPlatform;
  id: string;
  marks: Partial<Record<PlaybackMark, number>>;
};

export function createPlaybackTrace(platform: PlaybackPlatform, id: string): PlaybackTrace {
  return { platform, id, marks: {} };
}

export function recordPlaybackMark(trace: PlaybackTrace, mark: PlaybackMark, now = Date.now()): PlaybackTrace {
  if (trace.marks[mark] != null) return trace;
  trace.marks[mark] = now;
  return trace;
}

export type PlaybackDurations = {
  activeToMountMs: number | null;
  mountToLoadEndMs: number | null;
  loadEndToFirstFrameMs: number | null;
  activeToFirstFrameMs: number | null;
};

function delta(trace: PlaybackTrace, from: PlaybackMark, to: PlaybackMark): number | null {
  const start = trace.marks[from];
  const end = trace.marks[to];
  if (start == null || end == null) return null;
  return Math.max(0, end - start);
}

export function playbackDurations(trace: PlaybackTrace): PlaybackDurations {
  return {
    activeToMountMs: delta(trace, 'active', 'mount'),
    mountToLoadEndMs: delta(trace, 'mount', 'loadEnd'),
    loadEndToFirstFrameMs: delta(trace, 'loadEnd', 'firstFrame'),
    activeToFirstFrameMs: delta(trace, 'active', 'firstFrame'),
  };
}

/** Playing-signal log, and the Instagram poster fallback. Not the YouTube Watch reveal. */
export function shouldRevealFeedFrame(message: string): boolean {
  return message === 'firstFrame';
}

/** YouTube Watch lifts the poster when the embed iframe loads. `firstFrame` stays a log. */
export function shouldRevealYoutubePoster(message: string): boolean {
  return message === 'iframeLoaded';
}

let mountedPlayers = 0;

export function notePlayerMounted(): number {
  mountedPlayers += 1;
  return mountedPlayers;
}

export function notePlayerReleased(): number {
  mountedPlayers = Math.max(0, mountedPlayers - 1);
  return mountedPlayers;
}

export function playbackPlayerCount(): number {
  return mountedPlayers;
}

export function resetPlaybackPlayerCount(): void {
  mountedPlayers = 0;
}

export function playbackLogLine(
  trace: PlaybackTrace,
  event: PlaybackMark | 'playerVisible',
  mounted: number,
): string {
  return JSON.stringify({
    platform: trace.platform,
    id: trace.id,
    event,
    mountedPlayers: mounted,
    viewabilityHoldMs: FEED_VIEWABILITY_HOLD_MS,
    ...playbackDurations(trace),
  });
}
