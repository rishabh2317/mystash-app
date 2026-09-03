export type InstagramEmbedCrop = 'feed' | 'inline' | 'fullWidth';

type BuildInstagramEmbedHtmlOptions = {
  crop?: InstagramEmbedCrop;
};

const CROP_PRESETS: Record<
  InstagramEmbedCrop,
  { scale: number; translateY: string; embedPct: number }
> = {
  /** Home feed — slightly oversized so IG letterbox never shows on any phone width. */
  feed: { scale: 1.34, translateY: '-50%', embedPct: 145 },
  inline: { scale: 2.35, translateY: '-56%', embedPct: 240 },
  fullWidth: { scale: 2.65, translateY: '-58%', embedPct: 270 },
};

function resolveInstagramPermalink(embedUrl: string): string {
  const match = embedUrl.match(/instagram\.com\/(?:reel|reels|p|tv)\/([^/?#]+)/i);
  const id = match?.[1];
  if (!id) return embedUrl.replace(/\/embed\/?.*$/i, '');
  const isReel = /instagram\.com\/reels?\//i.test(embedUrl);
  return isReel
    ? `https://www.instagram.com/reel/${id}/`
    : `https://www.instagram.com/p/${id}/`;
}

/**
 * Full-page Instagram embed document used by the home feed WebView.
 * `embedUrl` should be an instagram.com URL containing `/p/{postId}/` or `/reel/{id}/`.
 */
export function buildInstagramEmbedHtml(
  embedUrl: string,
  options: BuildInstagramEmbedHtmlOptions = {},
): string {
  const crop = options.crop ?? 'feed';
  const preset = CROP_PRESETS[crop];
  const originalUrl = resolveInstagramPermalink(embedUrl);

  return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <style>
          body, html {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: black;
          }
          .crop-container {
            position: relative;
            width: 100vw;
            height: 100vh;
            overflow: hidden;
            display: flex;
            justify-content: center;
            align-items: center;
          }
          .instagram-media {
            position: absolute !important;
            top: 50% !important;
            left: 50% !important;
            transform: translate(-50%, ${preset.translateY}) scale(${preset.scale}) !important;
            transform-origin: center center !important;
            min-width: ${preset.embedPct}% !important;
            min-height: ${preset.embedPct}% !important;
            width: ${preset.embedPct}% !important;
            height: ${preset.embedPct}% !important;
            max-width: none !important;
            max-height: none !important;
            border: none !important;
            box-shadow: none !important;
            background: black !important;
            margin: 0 !important;
            pointer-events: auto !important;
          }
          .EmbedHeader, .EmbedFooter, .Feedback, .SocialProof, .HoverCard, .Caption,
          .Header, .Footer, .Comments, .Likes, .ShareButton, .FollowButton, .MoreButton,
          .Username, .Timestamp, .Location, .Description, .ActionBar {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
          }
          .Embed {
            padding: 0 !important;
            border: none !important;
            background: black !important;
            margin: 0 !important;
            max-width: none !important;
          }
          iframe {
            border: none !important;
            background: black !important;
            max-width: none !important;
            width: 100% !important;
            height: 100% !important;
            min-width: 100% !important;
            min-height: 100% !important;
          }
        </style>
      </head>
      <body>
        <div class="crop-container">
          <blockquote
            class="instagram-media"
            data-instgrm-permalink="${originalUrl}"
            data-instgrm-version="14"
            style="background:#000; border:0; margin:0; max-width:none; min-width:100%; padding:0; width:100%;">
          </blockquote>
        </div>
        <script async src="//www.instagram.com/embed.js"></script>
        <script>
          window.__mystashPendingMuted = true;
          var mystashBaseScale = ${preset.scale};
          var mystashTranslateY = '${preset.translateY}';
          var mystashEmbedPct = ${preset.embedPct};

          /** Cover viewport on any device — IG embeds letterbox; scale just enough to bleed past sides. */
          function mystashCoverScale() {
            var vw = Math.max(window.innerWidth || 0, 1);
            var vh = Math.max(window.innerHeight || 0, 1);
            var aspect = vw / vh;
            // Wider / shorter screens need a bit more horizontal bleed.
            var boost = aspect >= 0.56 ? 1.08 : aspect >= 0.5 ? 1.04 : 1.0;
            return Math.min(1.55, Math.max(mystashBaseScale, mystashBaseScale * boost));
          }

          function mystashApplyCover() {
            var scale = mystashCoverScale();
            var pct = Math.round(mystashEmbedPct * (scale / mystashBaseScale));
            document.querySelectorAll('.instagram-media, .Embed').forEach(function(el) {
              el.style.setProperty('max-width', 'none', 'important');
              el.style.setProperty('max-height', 'none', 'important');
              el.style.setProperty('width', pct + '%', 'important');
              el.style.setProperty('height', pct + '%', 'important');
              el.style.setProperty('min-width', pct + '%', 'important');
              el.style.setProperty('min-height', pct + '%', 'important');
              el.style.setProperty(
                'transform',
                'translate(-50%, ' + mystashTranslateY + ') scale(' + scale + ')',
                'important',
              );
              el.style.setProperty('transform-origin', 'center center', 'important');
            });
            document.querySelectorAll('iframe').forEach(function(frame) {
              frame.style.setProperty('max-width', 'none', 'important');
              frame.style.setProperty('width', '100%', 'important');
              frame.style.setProperty('height', '100%', 'important');
              frame.style.setProperty('min-width', '100%', 'important');
              frame.style.setProperty('min-height', '100%', 'important');
            });
          }

          function mystashForEachVideo(fn) {
            document.querySelectorAll('video').forEach(fn);
            document.querySelectorAll('iframe').forEach(function(frame) {
              try {
                var doc = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
                if (!doc) return;
                doc.querySelectorAll('video').forEach(fn);
              } catch (e) {}
            });
          }

          function mystashPrimeVideo(v) {
            try {
              v.muted = window.__mystashPendingMuted !== false;
              v.defaultMuted = v.muted;
              v.playsInline = true;
              v.setAttribute('playsinline', '');
              v.setAttribute('webkit-playsinline', '');
              v.autoplay = true;
              v.loop = true;
              v.play().catch(function() {});
            } catch (e) {}
          }

          function mystashApplyInstagramMuted(muted) {
            mystashForEachVideo(function(v) {
              try {
                v.muted = muted;
                v.defaultMuted = muted;
                if (!muted) v.play().catch(function() {});
              } catch (e) {}
            });
          }

          function mystashHideWatchCta() {
            var nodes = document.querySelectorAll('a, button, span, p, div');
            for (var i = 0; i < nodes.length; i++) {
              var el = nodes[i];
              if (el.children && el.children.length > 2) continue;
              var t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
              if (!t || t.length > 48) continue;
              if (/watch on instagram/i.test(t)) {
                el.style.display = 'none';
                el.style.visibility = 'hidden';
                el.style.pointerEvents = 'none';
                if (el.parentElement && (el.parentElement.textContent || '').trim().length < 64) {
                  el.parentElement.style.display = 'none';
                }
              }
            }
          }

          function mystashTapPlay() {
            var cx = Math.round(window.innerWidth / 2);
            var cy = Math.round(window.innerHeight / 2);
            var target = document.elementFromPoint(cx, cy);
            if (!target) return;
            ['pointerdown', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend'].forEach(function(type) {
              try {
                target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
              } catch (e) {}
            });
          }

          window.__mystashKickPlayback = function() {
            mystashApplyCover();
            mystashForEachVideo(mystashPrimeVideo);
            mystashHideWatchCta();
            var playing = false;
            mystashForEachVideo(function(v) {
              if (!v.paused && v.readyState >= 2) playing = true;
            });
            if (!playing) mystashTapPlay();
          };

          window.__mystashSetMuted = function(muted) {
            window.__mystashPendingMuted = muted;
            mystashApplyInstagramMuted(muted);
            if (!muted) mystashTapPlay();
          };

          window.addEventListener('load', function() {
            mystashApplyCover();
            window.__mystashKickPlayback();
            setTimeout(function() {
              window.__mystashSetMuted(window.__mystashPendingMuted);
              window.__mystashKickPlayback();
              if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage('videoReady');
            }, 600);
          });

          window.addEventListener('resize', function() {
            mystashApplyCover();
          });

          var observer = new MutationObserver(function() {
            mystashApplyCover();
            window.__mystashKickPlayback();
          });
          observer.observe(document.documentElement, { childList: true, subtree: true });

          var kickUntil = Date.now() + 12000;
          var kickTimer = setInterval(function() {
            mystashApplyCover();
            window.__mystashKickPlayback();
            if (Date.now() > kickUntil) clearInterval(kickTimer);
          }, 350);
        </script>
      </body>
      </html>
    `;
}

export { resolveInstagramPermalink };
