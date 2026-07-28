/**
 * Full-page Instagram embed document used by the home feed WebView.
 * `embedUrl` should be an instagram.com URL containing `/p/{postId}/` (e.g. from transformToReviewEmbedUrl).
 */
export function buildInstagramEmbedHtml(embedUrl: string): string {
  const postId = embedUrl.match(/instagram\.com\/p\/([^/]+)/)?.[1];
  const originalUrl = postId ? `https://www.instagram.com/p/${postId}/` : embedUrl;

  return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
            transform: translate(-50%, -50%) scale(1.10) !important;
            transform-origin: center center !important;
            min-width: 110% !important;
            min-height: 110% !important;
            width: 110% !important;
            height: 110% !important;
            border: none !important;
            box-shadow: none !important;
            background: black !important;
            margin: 0 !important;
            pointer-events: auto !important;
          }
          .instagram-media::after {
            content: '';
            position: absolute !important;
            top: 50% !important;
            left: 50% !important;
            transform: translate(-50%, -50%) !important;
            width: 80px !important;
            height: 80px !important;
            z-index: 1000 !important;
            pointer-events: auto !important;
          }
          .instagram-media::before {
            content: '';
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            z-index: 999 !important;
            pointer-events: none !important;
            background: rgba(0,0,0,0.9) !important;
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
          }
          iframe {
            border: none !important;
            background: black !important;
          }
        </style>
      </head>
      <body>
        <div class="crop-container">
          <blockquote 
            class="instagram-media" 
            data-instgrm-captioned 
            data-instgrm-permalink="${originalUrl}" 
            data-instgrm-version="14" 
            style=" background:#FFF; border:0; border-radius:3px; box-shadow:0 0 1px 0 rgba(0,0,0,0.5),0 1px 10px 0 rgba(0,0,0,0.15); margin: 1px; max-width:540px; min-width:326px; padding:0; width:99.375%; width:-webkit-calc(100% - 2px); width:calc(100% - 2px);">
          </blockquote>
        </div>
        <script async src="//www.instagram.com/embed.js"></script>
        <script>
          window.addEventListener('load', function() {
            setTimeout(function() {
              window.ReactNativeWebView.postMessage('videoReady');
            }, 1500);
          });
          
          document.addEventListener('message', function(event) {
            if (event.data === 'pause') {
              console.log('Pause requested for Instagram video');
            }
          });
          
          setTimeout(function() {
            const hideUI = setInterval(function() {
              const selectors = [
                '.EmbedHeader', '.EmbedFooter', '.Feedback', '.SocialProof', '.HoverCard', '.Caption',
                '.Header', '.Footer', '.Comments', '.Likes', '.ShareButton', '.FollowButton', '.MoreButton',
                '.Username', '.Timestamp', '.Location', '.Description', '.ActionBar',
                'header', 'footer', 'nav', 'button', 'a[href*="instagram.com"]'
              ];
              
              selectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                  el.style.display = 'none !important';
                  el.style.visibility = 'hidden !important';
                  el.style.opacity = '0 !important';
                  el.style.pointerEvents = 'none !important';
                });
              });
              
              const embeds = document.querySelectorAll('.instagram-media, .Embed');
              embeds.forEach(el => {
                el.style.padding = '0 !important';
                el.style.border = 'none !important';
                el.style.background = 'black !important';
                el.style.margin = '0 !important';
                el.style.minWidth = '120% !important';
                el.style.minHeight = '120% !important';
                el.style.width = '120% !important';
                el.style.height = '120% !important';
              });
              
              const textElements = document.querySelectorAll('span, p, h1, h2, h3, h4, h5, h6');
              textElements.forEach(el => {
                if (el.textContent.length < 100) {
                  el.style.display = 'none !important';
                }
              });
            }, 50);
            
            setTimeout(function() {
              clearInterval(hideUI);
            }, 15000);
          }, 2000);
        </script>
      </body>
      </html>
    `;
}
