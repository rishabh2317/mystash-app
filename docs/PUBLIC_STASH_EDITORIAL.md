# Browser Public Stash editorial presentation

Implemented 19 November 2026. The standalone public-web collection entry renders the editorial component; the normal native route and shared native cards are unchanged.

## Files

- `public-web/app/stash/[publicId]/index.tsx`: browser collection entry only.
- `public-web/components/PublicStashEditorial.tsx`: public API loading, header, URL-backed tabs, deterministic cards, explicit provider-photo demand, loading/empty/error states and pagination.
- `public-web/components/public-stash-editorial.css`: warm paper presentation, responsive editorial grid, focus states and reduced motion.
- `public-web/components/editorialActions.ts`: existing identity routes, ordered stored offer selection, country preference, authorized affiliate/discovery redirects and canonical sharing.
- `public-web/app/_layout.tsx`: collection-only warm privacy footer; the collection is intentionally light. Detail/auth appearance and privacy controls remain available.
- `public/home/media/attribution/google-maps-dark.png`: unchanged existing attribution asset copied to the static web path.
- `scripts/check-public-stash-editorial.cjs`: offline action regression checks.
- `scripts/preview-public-stash-editorial.cjs`: localhost-only fixture API and preview server. Never used by the production runtime.

## Reference comparison

Preserves the warm canvas, rounded paper container, subtle border, circular curator initial/avatar, restrained typography, header-side Share button, large first photograph, two smaller photographs underneath, and small bookmark footer. The sheet is upright rather than decoratively rotated. Published counts, Products/Places tabs, readable item captions, and always-visible Shop/Explore controls are deliberate functional additions. Mobile retains the hero-plus-pair identity with adapted framing. Two-item collections use balanced paired photographs on larger screens and stack on mobile. A stable six-item sequence continues the layout for pagination.

Live titles, counts, usernames, avatars, item names and photographs come from the existing public API. There is no illustrative live curator or content. The contract does not currently expose a custom Stash title, so the header uses `@username’s Stash`.

## Behavior and safety

Product image/title links open the existing Product Page. Shop fetches that same authorized stored Product Page on demand, respects the same saved country preference, selects the first ordered actionable offer, and resolves it through the existing outbound route with the offer ID and outbound event headers. Existing supported discovery destinations are used when there is no actionable offer; if neither exists, the existing Product Page opens. No merchant destination is fabricated. No offer, image or detail API contract changed.

Place title/Explore links open the existing Place detail screen with its original address, map, directions, search and saving behavior. Place photos require an explicit Show photo action; scrolling the grid does not fetch provider photos. The existing four-task queue, width cap, public membership authorization and image/attribution validators remain in use. Attributions and report links are separate from the detail link. No provider response is persisted.

Tabs use query parameters and real hrefs, support Left/Right/Home/End keys, and preserve browser Back/Forward. Each tab has independent load state. Fetches are cancelled on scope/focus changes; pageshow and visibility restoration revalidate. A 404 during pagination clears all loaded cards and curator metadata. Public/authenticated API and publication checks are unchanged.

Share uses only the canonical `https://mystash.in/stash/:publicId` URL. Native browser sharing is attempted when available. Copy Link is available after opening Share, and copying announces success through a live status region. If clipboard access is denied, the canonical URL is displayed for manual copying. Preview-only collections do not expose sharing or direct shopping.

## Verification

- Client TypeScript passed.
- Targeted ESLint passed without warnings.
- Production-format Expo web export passed using dummy offline auth configuration for preview; deployment builds use the existing production environment.
- Backend TypeScript build and all 32 existing Public Stash/ProductPage regression tests passed.
- `node scripts/check-public-product-page.cjs` passed: stored public offers retained, public search/pricing effects suppressed, standard/native effect behavior preserved.
- `node scripts/check-public-stash-editorial.cjs` passed: namespace identity routes; ordered actionable offers; discovery and no-offer fallbacks; saved country; outbound attribution; canonical share/copy; share cancellation; clipboard failure fallback.
- Browser visual review: 320, 375, 390, 430, 768, 1280 and 1440px; no horizontal overflow. No nested interactive elements in the collection DOM. Focusable links/buttons, tab ARIA, explicit image dimensions/aspect ratios and reduced-motion CSS checked.
- Reviewed 0, 1, 2, 3, 5 and 25-item fixture collections. Pagination appended 20 to 25 items without duplicates. A separate open fixture was revoked before pagination: next read showed unavailable with zero remaining cards.
- Browser checks: anonymous collection; Products/Places switching and ArrowLeft navigation; Back to Places after detail navigation; existing Product Page, country selector and stored buying option; Place detail with maps/directions/search; anonymous Save leads to existing sign-in; direct Shop reaches the fixture verified-offer destination; Copy Link shows accessible success.
- Local fixture request log showed zero photo endpoint calls for scrolling the 25-item Places grid. No production paid photo/search work was triggered for testing.
- Browser console contained no errors/warnings in final collection review.

Screenshots are in ignored `output/public-stash-editorial/`, including `desktop-1440.jpg`, `desktop-1280.jpg`, `tablet-768.jpg`, `mobile-320.jpg`, `mobile-375.jpg`, `mobile-390.jpg`, `mobile-430.jpg`, and collection-size examples. Screenshots use clearly isolated local API fixtures, not real user collections.

## Verification limits

Native share sheet appearance depends on the browser/OS; its success, failure and cancellation paths are tested through injected adapters. No message was sent to a recipient. Live merchant purchases, production save writes, authenticated owner sessions and paid Google imagery were intentionally not exercised. Their existing endpoints/screens are retained, and contract regressions passed. Public Stash data offers no focal-point metadata, so photographs use stable centered cover framing without stretching. Place photographs remain opt-in to honor the no-scroll-cost requirement.

No Android/iOS app was built, installed or deployed. No shared native screen/card, API, publication permission, identity, database schema, or native save/shopping implementation was edited.
