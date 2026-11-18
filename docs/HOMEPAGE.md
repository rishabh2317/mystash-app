# Mystash homepage

## Creative concept

“Life catches your eye. Give it a place to stay.” An editorial discovery index brings spaces, objects, places and everyday rituals into the same personal world. The overlapping photographic keepsakes lead into an interactive discovery shelf, a screenshot-to-discovery scenario, a Public Stash example and a creator story. Warm paper and quiet sage extend the app’s neutral Titanium palette; Inter remains the primary typeface, with system Georgia used sparingly for editorial emphasis.

The page uses the existing app’s bookmark affordance, rounded media, category metadata and restrained card chrome. Marketing cards are semantic HTML adaptations, avoiding mobile components that import authentication, pricing and discovery services. Examples are explicitly illustrative; Sonam is an example curator, not a testimonial or claimed user. The homepage deliberately uses a fixed light art direction; the existing Nebula and Titanium app themes are untouched.

## Audit and implementation

The Expo public website lives in `public-web/app`; the mobile routes live in `app`. Both root placeholders were found: the Expo landing screen and the Express `/` handler. Production public routing is in `backend/src/public-stash/web.ts`. Public Stash, item, authentication and domain association handlers remain in that module. Creator and collection mobile routes remain unchanged; the homepage adds no competing route patterns.

The homepage is static source in `public/home`. Expo’s existing export automatically copies the standard `public` directory. Express serves `home/index.html` at `/` and its resources under `/home`. The Expo root redirects to `/home/` for Expo development and static exports. The root Dockerfile now includes `public` in the existing web build. There is no framework, dependency, runtime API request, AI request, search request, analytics collector or persistent browser storage added to the homepage. The existing public Expo app retains its own providers and analytics behavior.

The primary CTA goes to a working interactive preview. There were no verified live store URLs available during this implementation; no download claim or waitlist was invented. A future download CTA should use the release-operator verified URLs already supported by `PublicAppActions.tsx`.

## Changed files

- `public/home/index.html`: complete static homepage and metadata.
- `public/home/style.css`: responsive editorial layout, states and reduced motion rules.
- `public/home/home.js`: ephemeral preview saves, filtering, reset and announcements.
- `public/home/media/`: bundled photographs, responsive variants, Inter faces and licenses, existing favicon and social image.
- `public-web/app/index.tsx`: Expo root fallback to the homepage.
- `backend/src/public-stash/web.ts`: static root and assets, homepage-only sitemap and robots response; existing shared pages keep `noindex,follow`.
- `backend/src/public-stash/homepage.test.ts`: homepage availability, static asset, metadata endpoint and existing route regression coverage.
- `Dockerfile.public-stash`: includes the standard public directory in the existing export.
- `scripts/preview-homepage.cjs` and `package.json`: local static homepage preview command.
- `docs/HOMEPAGE.md`: handoff and asset provenance.

## Local preview and release

Run `npm run homepage:preview` from the repository root, then visit `http://127.0.0.1:4174/`. It uses Express already installed for the backend. Change the port with `PORT=4175 npm run homepage:preview`. This command previews only the marketing homepage; shared content requires the existing public web/backend environment.

Run `npm run public-stash:web:export` for the full public web export. Keep `public-web/dist/index.html` as the Expo entry; never replace it with the marketing HTML. The homepage will be exported at `public-web/dist/home/index.html`.

Deploy through the existing root-context `Dockerfile.public-stash` pipeline when approved, retaining its current public environment and domain association configuration. `PUBLIC_STASH_WEB_DIR` must point at the exported directory containing both the Expo `index.html` and `home/`. The homepage canonical, Open Graph and sitemap domain is the established `https://mystash.in`. If using another domain, change those URLs together. No new service, DNS change or paid hosting tier is required. No deployment or DNS change was performed.

## Verification

- Client TypeScript check passed.
- Targeted ESLint for the Expo landing screen, homepage JavaScript and preview script passed.
- Backend TypeScript build passed.
- Full public Expo export passed; homepage files were confirmed in the export alongside the Expo entry.
- Public Stash regression suite passed: 31 tests, including the added homepage route check.
- Browser checks: 320, 375, 390, 430, 768, 1280, 1440 and 1920px; no horizontal overflow or broken loaded images.
- Full-page desktop and 320px mobile screenshots inspected; 390px screenshots also captured. The narrowest headline wrapping was refined after inspection.
- Browser interactions verified: main CTA, keyboard Enter to save, product filtering, reset and live status announcements.
- Semantic headings, descriptive image alternatives, native links/buttons, visible focus, 44px primary touch controls and reduced motion rules included. All content renders without JavaScript; the demo interactions require JavaScript.
- Responsive image candidates, lazy images below the fold, reserved media dimensions, local font swapping and less than 20 KB of application JavaScript. No heavy animation library. The postcard experiment uses a passive scroll listener with requestAnimationFrame batching and suspends animation updates outside the hero.

No Lighthouse score, automated axe score or real-device performance result is claimed. Browser QA used the in-app Chromium browser; Safari, Firefox, screen-reader hardware and slow-network field metrics remain release checks. The photographs are illustrative, not verified venue or catalogue records. The preview lasts only for this visit and does not save to a real account. Public Stash and creator scenarios communicate the existing product but do not implement new public pages or a video player.

## Asset provenance

Photographs were downloaded from Unsplash’s image CDN and bundled locally, with no external requests at runtime. Use is under the [Unsplash license](https://unsplash.com/license). Source identifiers are retained here so assets can be audited or replaced with commissioned Mystash photography:

- Interior: `photo-1600210492486-724fe5c67fb0` — `https://images.unsplash.com/photo-1600210492486-724fe5c67fb0`.
- Chair: `photo-1567538096630-e0c55bd6374c` — `https://images.unsplash.com/photo-1567538096630-e0c55bd6374c`.
- Villa: `photo-1613490493576-7fde63acd811` — `https://images.unsplash.com/photo-1613490493576-7fde63acd811`.
- Coffee: `photo-1442512595331-e89e73853f31` — `https://images.unsplash.com/photo-1442512595331-e89e73853f31`.
- Camera: `photo-1516035069371-29a1b244cc32` — `https://images.unsplash.com/photo-1516035069371-29a1b244cc32`.
- Style: `photo-1483985988355-763728e1935b` — `https://images.unsplash.com/photo-1483985988355-763728e1935b`.

Inter fonts come from the existing `@expo-google-fonts/inter` dependency; package and SIL font licenses are included in `public/home/media`. Favicon is copied from the existing Mystash asset. The wordmark is set in Inter with a simple bookmark motif; no trademark registration claim is made.

## Reversible postcard scroll experiment

The hero board now briefly pins while its four postcards gather into a green Stash pocket. The transition follows scroll position and reverses when scrolling back. Original hover movement remains before the gathering begins. It adds no dependency, API request or actual saved item. The separate discovery-shelf save demo now displays saved discoveries as visual cards; the approved postcard animation remains unchanged.

For an immediate A/B comparison, open the same homepage with `?postcards=static`. This restores the original board composition and original page spacing. Set `ENABLE_SCROLL_STASH_EXPERIMENT = false` in `public/home/home.js` to disable the experiment by default. Exact copies of the three original homepage files were also retained locally in `tmp/homepage-postcard-baseline/`; copy them back only if no later changes to those files need preserving.

Reduced-motion preferences disable both gathering and the extra scroll distance, including when the preference changes while the page is open. Content remains available without JavaScript. The animation uses transforms and opacity; its geometric measurements happen at setup/resize rather than for each card on every scroll.

Visually checked collected states at desktop and 390px mobile, reverse scrolling back to the original board, and the static comparison. Screenshots are in `output/mystash-homepage/postcards-collected-desktop.jpg` and `postcards-collected-mobile.jpg`. Reduced-motion behavior was checked in source; browser-level preference emulation was not available.

## Visual preview Stash

The preview now builds an image-led collection with Product/Place labels, item names, a visible count, individual 44px remove controls and a clear-all action. The empty state invites saving; original discovery cards switch their bookmark state and label to “Saved to your Stash.” Saves remain private to this page visit, with no storage, API or account integration.

Existing shelf cards retain their DOM nodes when other items are added or removed; only new cards receive the brief reduced-motion-aware entrance. Individual removal synchronizes the source bookmark, restores an appropriate keyboard focus target and announces the change. Filtering the discovery grid never filters or clears saved items.

Verified saving, individual removal, clearing, source-state synchronization, keyboard focus and saves surviving filters in the browser. Populated shelf checked from 320 through 1440px with no overflow, and screenshots captured at desktop and 390px. The hero HTML and postcard drawing/path code remain unchanged; the later compact-shelf refinement adjusts only the animation trigger and scroll distance. The local approved snapshot is in `tmp/homepage-postcards-approved/`.

Screenshots: `output/mystash-homepage/visual-stash-desktop.jpg` and `visual-stash-mobile.jpg`.

## Compact cupboard shelf and tighter scroll timing

At the user’s request, the postcard gathering now starts earlier (sticky top cap 160px instead of 70px) and uses 180px of mobile scroll distance instead of 340px, or 260px instead of 480px on desktop. This removes roughly 46–47% of the extra runway. The postcard paths, scales, stagger, pocket rendering, hover behavior and reduced-motion fallback are unchanged, verified against the approved snapshot after normalizing only those two timing values.

The preview uses a shallow cupboard-style shelf instead of a dotted empty-state panel and large saved cards. The cabinet is at most 480px wide and 140px tall on mobile / 164px on desktop, with a warm wood frame and ledge. All four discoveries fit as small photo cards on one shelf, even at 320px. Names remain accessible in full and are also available as hover titles; visual names may wrap/truncate at the smallest width. Remove controls retain 44px hit areas despite the small circular visual treatment. Filtering, clearing, individual removal and ephemeral save behavior are retained.

Pre-change source copies are in `tmp/homepage-before-compact-shelf/`. Screenshots: `output/mystash-homepage/compact-shelf-empty.jpg` and `compact-shelf-filled.jpg`.

## Paper collection folio

Replaced the wooden cabinet treatment with a layered paper folio: warm neutral sheets, fine sage outlines, a small “The Good Finds” index tab and a folded sage lower edge. Container dimensions, placement, four miniature card slots and remove hit areas are preserved. The postcard animation and save logic were not changed. The empty-state helper now describes keeping inspiration rather than placing items on a shelf.

The empty and filled folio were visually checked at 520px, with populated layouts checked at 320, 390, 768 and 1440px. Screenshot: `output/mystash-homepage/collection-folio.jpg`.

## Scroll closing line

Added a decorative “Love it. Stash it.” above the gathered postcards. Its opacity follows the final 16% of the existing gather progress and reverses with the same progress, fading out as the cards open back up. It adds no height or scroll distance and does not alter postcard paths or timing. It is hidden for reduced motion, without JavaScript, and in the static comparison. The approved folio markup, existing styles and save logic were verified unchanged against `tmp/homepage-approved-folio/`.

Visually verified the settled state and reverse fade in the browser, and checked 320, 390, 768 and 1440px for overflow. Screenshot: `output/mystash-homepage/love-it-stash-it.jpg`.

## Get App and legal/support page shells

The top-right navigation label is now “Get App”; its existing `#discover` destination is retained until a verified live app destination is available. The central “Take a little look” demo CTA remains unchanged.

Added footer links and static page outlines at `/privacy`, `/terms`, `/cookies`, `/account-deletion`, `/contact` and `/content-policy`. Content files are in `public/home/legal/`, with editing instructions in `docs/LEGAL_PAGES.md` and shared `legal.css`. The six explicit Express routes are separate from public Stash, auth and association routes, and the local preview server has matching routes. Draft pages identify themselves as placeholders, carry `noindex,follow`, and are excluded from the sitemap. No legal promises, contact addresses or fake submission forms were added. Final approved content still needs to be supplied; these shells do not establish legal completeness.

Verification: targeted preview-script lint, backend TypeScript build, public web export and all 31 Public Stash regression tests passed. The existing route regression test now checks all six legal destinations. All six pages were opened through footer links in the browser; their titles, canonical route paths, noindex metadata and section anchors were checked. Responsive checks passed at 320, 390, 768 and 1440px. No production deployment was performed.

## Smile outline logo trial

The homepage header and footer now use the user-supplied `02-Original-Smile-Outline.svg` from `/Users/rishabh/Downloads/mystash-final-outline`. The unchanged master is retained at `public/home/media/mystash-smile-outline.svg`; its paths are embedded inline in the two homepage wordmarks so `currentColor` inherits the existing `#20221F` logo ink. The supplied viewBox and 2.4-unit strokes are preserved. The icon is decorative within the existing labeled home links.

Responsive SVG frames use 40px on desktop, 34px on medium mobile and 30px on small mobile; the footer uses 34px. Checked 320, 375, 390, 430, 768 and 1440px with no overflow and verified the inherited color in the browser. Legal-page wordmarks, favicon, mobile app and all frozen homepage interactions are unchanged. Screenshots: `output/mystash-homepage/smile-logo-desktop.jpg` and `smile-logo-mobile.jpg`.

## Minimal Fold logo trial and CTA watermark

Switched the two homepage wordmarks to the other supplied variation, `01-Minimal-Fold-Outline.svg`, retaining the existing logo color and responsive icon frame sizes. Its unchanged master is in `public/home/media/mystash-minimal-outline.svg`; the smile master is retained for comparison/reversion. Both header and footer embed the Minimal Fold paths inline.

Replaced the final CTA’s oversized decorative “m.” text with the same Minimal Fold SVG. The mark is oversized, rotated and cropped within the existing dark section, using a faint light outline. It is decorative, ignores pointer input and remains behind the CTA content. No animation or folio behavior changed.

Checked desktop and mobile compositions, and fresh page loads at 320, 390, 430, 768 and 1440px with no horizontal overflow. Existing off-screen postcard transforms can briefly affect width measurements during artificial multi-size browser resizing; verification used settled fresh page loads. Web export passed. Screenshots: `output/mystash-homepage/minimal-logo-header.jpg`, `minimal-logo-watermark.jpg`, and `minimal-logo-watermark-mobile.jpg`.

## Interactive three-option Find demo

Replaced the discovery shelf’s four static browse cards with the app’s actual Find entry points: **Paste URL, Gallery and Camera**, verified against `components/find/FindCaptureActions.tsx`. The section now demonstrates read → identify products/places → automatically save, matching the app’s automatic-stash copy in `src/ui/find.ts`.

The three prepared examples run entirely in the browser, with no uploads, clipboard access, camera permission, API request or paid/live AI call. Their illustrative status and the fact that real results vary are stated beside the action. Paste URL uses a read-only example.com sample link; Gallery shows a sample travel board; Camera shows a sample room photo. Scene scanning, detection outlines, staged progress, result entrance and the existing folio entrance illustrate the flow. Reduced motion completes the run immediately and disables animated effects.

URL identifies the reading chair and coffee stop; Gallery identifies the hideaway and camera; Camera identifies the reading chair. These are fixed illustrative examples rather than claimed actual venue/catalogue matches. Each completed example automatically adds its discoveries to the same visit-only preview Stash. Removing an item from the result or folio synchronizes both controls. Reruns do not duplicate saved items; removed results can be added again. Switching modes and Cancel invalidate pending timers without clearing previous saves. Clear preview cancels an active demo so later callbacks cannot repopulate a cleared Stash. Keyboard tabs support arrows, Home and End; removal and cancellation restore focus appropriately.

On phones the source frame sits between the sample fields and the run action so the scan remains visible when activating the button. The folio design, logo trials, postcard hero, scroll gathering paths and all public/legal routes are preserved. Pre-change source copies are in `tmp/homepage-before-find-demo/`.

Browser validation covered all three outcomes, automatic saving, duplicate-free reruns, individual removal, rerun restoration, mode-switch cancellation, explicit cancellation, clear during an active run, and keyboard tab selection. The complete URL-to-Stash flow passed at 320, 375, 390, 430, 768, 1280 and 1440px with two visible results, two saved items, no broken loaded images and no horizontal overflow at each width. Screenshots: `output/mystash-homepage/find-demo-desktop.jpg` and `find-demo-mobile.jpg`; measurements are in `find-demo-responsive.json`.

## Continuous extraction refinement

Removed the separate “Found in this example / A little inspiration, identified” section and its large result rows. The demo now uses one accessible progress bar with a moving star/sheened fill and a changing status line. Internal progress states still coordinate the illustrative sequence, but there is no numbered three-step UI.

The source frame is smaller (320×220px maximum on desktop, 260×175px on mobile). Two compact photo-and-title discovery cards emerge from it during identification. During saving, short-lived decorative copies animate toward the existing folio; they are removed after the animation. Compact cards report saved/removed state while the folio retains the actual removal controls. The former result markup remains only as a hidden local sample-data source, never as a visible results block.

The progress bar exposes 0–100 values and descriptive value text. Reduced motion suppresses shimmer/card flight and completes immediately. Mode changes, Cancel and Clear cancel both timers and temporary flying cards. No live AI, uploads or API requests were introduced; prepared examples remain labeled.

Browser checks covered flight appearance at 86%, cancellation returning to 0% with zero temporary nodes, no late saves after cancellation, duplicate-free reruns, folio removal updating compact-card labels, and clear restoring the empty folio. Gallery-to-Stash completed successfully at 320, 375, 390, 430, 768, 1280 and 1440px with two saves, 100% progress, no broken loaded images, no horizontal overflow and no duplicate results section. Screenshots: `output/mystash-homepage/find-magic-desktop.jpg` and `find-magic-mobile.jpg`; measurements: `find-magic-checks.json`. Source before this refinement is in `tmp/homepage-before-find-refinement/`.

## Collapse unused extraction space and restore smile branding

The extraction output now occupies zero height in idle/reading states, with no reserved stage minimum. It expands when identification reveals the cards (90px mobile / 96px desktop), then collapses smoothly when selecting another example or cancelling. Source-to-caption spacing is 15px when empty. Reduced-motion rules remove the transitions. Existing auto-save, progress and flight behavior is unchanged.

Restored the supplied Original Smile Outline in the homepage header, footer and dark CTA watermark. Added the same inline, theme-colored mark to the header and footer of all six legal/support pages. Their content and routes are unchanged.

Verified collapse → extraction → automatic saving at 320, 390, 768 and 1440px: output height starts at zero, expands to the expected size, saves two sample items and does not overflow. All six legal pages show two smile marks in the existing `#20221F` ink, with no overflow at mobile width. Screenshots: `output/mystash-homepage/find-collapsed-mobile.jpg` and `privacy-smile-logo.jpg`. Pre-change homepage source is in `tmp/homepage-before-collapse-smile/`.
