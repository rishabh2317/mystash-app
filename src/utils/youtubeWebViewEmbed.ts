import Constants from 'expo-constants';

const DEFAULT_YT_PARENT_ORIGIN = 'https://mystash.app';

/** 11-char id from any common YouTube / Shorts / embed URL shape (same as home feed). */
export function extractYoutubeVideoIdFromUrl(embedOrWatchUrl: string): string | null {
  const u = embedOrWatchUrl.trim();
  const m =
    u.match(/(?:embed\/|\/shorts\/|\/v\/|youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/) ??
    u.match(/([a-zA-Z0-9_-]{11})(?=[?&]|$)/);
  return m?.[1] ?? null;
}

/**
 * Must be https and must NOT be youtube.com — same-origin there breaks embed (Error 152/153).
 * Reads `expo.extra.youtubeEmbedOrigin` from app.json (same as YouTubeReelItem).
 */
export function resolveYoutubeParentOrigin(): string {
  const extra = Constants.expoConfig?.extra as { youtubeEmbedOrigin?: string } | undefined;
  const raw = (extra?.youtubeEmbedOrigin ?? DEFAULT_YT_PARENT_ORIGIN).trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(raw)) return DEFAULT_YT_PARENT_ORIGIN;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (!host || host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com') {
      return DEFAULT_YT_PARENT_ORIGIN;
    }
    return `${u.protocol}//${u.host}`;
  } catch {
    return DEFAULT_YT_PARENT_ORIGIN;
  }
}

/** HTML document + iframe params used by the home feed WebView (must match `baseUrl`). */
export function buildYoutubeWebHtml(videoId: string, parentOrigin: string): string {
  const q = new URLSearchParams({
    autoplay: '1',
    mute: '1',
    playsinline: '1',
    controls: '1',
    modestbranding: '1',
    rel: '0',
    enablejsapi: '1',
    origin: parentOrigin,
  });
  const src = 'https://www.youtube.com/embed/' + encodeURIComponent(videoId) + '?' + q.toString();

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
    .crop-container {
      position: relative; width: 100vw; height: 100vh; overflow: hidden;
      display: flex; justify-content: center; align-items: center;
    }
    iframe#videoPlayer {
      position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; border: none;
      transform: scale(1.12); transform-origin: center center;
    }
  </style>
</head>
<body>
  <div class="crop-container">
    <script>
      window.__mystashPendingMuted = true;
      window.__mystashPlayer = null;
      function ytCmd(func, args) {
        var iframe = document.getElementById('videoPlayer');
        if (!iframe || !iframe.contentWindow) return;
        iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: func, args: args || [] }), '*');
      }
      window.__mystashSetMuted = function(muted) {
        window.__mystashPendingMuted = muted;
        try {
          if (muted) ytCmd('mute');
          else {
            ytCmd('unMute');
            ytCmd('setVolume', [100]);
            ytCmd('playVideo');
          }
        } catch (e) {}
      };
    </script>
    <iframe
      id="videoPlayer"
      src="${src}"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      allowfullscreen
      onload="(function(){try{window.__mystashSetMuted(window.__mystashPendingMuted);if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage('videoReady')}catch(e){}})()"
    ></iframe>
  </div>
</body>
</html>`;
}
