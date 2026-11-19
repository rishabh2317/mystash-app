# Browser Public Stash — compact pin board

Updated 19 November 2026 after the editorial hero layout review. The web collection now uses a Pinterest-style masonry board. The earlier full-width hero and forced image crops have been removed.

## Header and previous copy

The original live header contained “Public Stash”, “Curated by @username”, Products/Places counts and Share, plus Back and an owner-only preview notice. The first editorial revision retained the public identifier, curator, counts and Share but simplified Back/preview copy. Back and the full “Only you can see this preview” notice are restored.

The latest requested header is `Sonam’s Stash`, then `@username`, then the optional public profile bio, followed by published counts. First name is the first whitespace-separated part of the profile display name; there is no separate first-name field. Missing names fall back to `@username’s Stash`. Missing bios leave no empty description block. These fields come from the existing public `/users/by-username/:username` endpoint after the authorized Stash read. No email, private settings or raw user UUID is rendered. Profile results are scoped to the current username/account and discarded when obsolete. Profile lookup failure leaves the Stash usable.

## Changed files

- `public-web/components/PublicStashEditorial.tsx`: pin board, restored Back/preview notice, public name/handle/bio, scoped data loading and Shop orchestration.
- `public-web/components/public-stash-editorial.css`: compact masonry columns, natural product framing, hover/focus/touch actions and browser bottom-sheet styles.
- `public-web/components/BuyOptionsSheet.tsx`: accessible browser-only merchant-choice sheet.
- `public-web/components/editorialActions.ts`: first-name title, stored offer loading and explicit selected-offer outbound resolution.
- `scripts/check-public-stash-editorial.cjs`: offline title, single/multiple offers, selected merchant, fallback and sharing tests.
- `scripts/preview-public-stash-editorial.cjs`: local-only public profile and multiple-merchant fixtures.
- This report.

The prior web collection route, warm web-only privacy footer and approved attribution asset remain in place. No native card, screen, app route, API contract, publication rule, database schema or merchant redirect handler changed.

## Pin layout and interactions

At larger widths, cards have five compact equal-width columns; smaller desktop/tablet use four/three and mobile uses two. Stable index-to-column assignment keeps existing cards in their columns when pagination appends items. Photos use their natural proportions with contain framing for products, bounded minimum/maximum heights, and no stretched hero crop. The initial placeholder reserves space while intrinsic dimensions load; the current public item API does not expose image dimensions, so a pin may adjust height when its image metadata arrives.

Each pin has a readable two-line product label and brand/location below the image. Shop and View appear on hover and keyboard focus. Actions remain visible on touch devices and narrow screens. Links and buttons are siblings, not nested interactive controls. Product and Place detail links retain their existing routes and saving/authentication behavior. Failed images have a compact explicit fallback.

Place photography is still opt-in via Show photo. Scrolling does not issue provider-photo requests. Existing queue limits, membership checks and image/attribution validators remain. Provider credits stay separate from the detail link.

## Buying options

The same native `shoppableProductOffers` and `feedShopPresentation` helpers decide presentation:

- One actionable stored offer opens directly.
- Multiple actionable offers open Buy options and wait for a merchant choice.
- Offers with action `none` are excluded.
- No actionable offer uses the existing supported discovery destination, or opens Product Page if no destination exists.

The sheet shows product name, merchant, stored formatted price, availability, and country context. It reuses the Product Page price formatter. Selecting an offer resolves that exact offer ID through the existing public outbound endpoint with outbound analytics headers. Country preferences match Product Page; affiliate routing stays server-side. No merchant URL is fabricated and no live pricing/search requests are started for the sheet.

The native HTML dialog provides a modal focus boundary. Close, Escape and backdrop dismissal are supported; keyboard focus returns to the triggering Shop button. In-flight outbound requests are aborted on dismissal/unmount. Header/close controls remain available while a long offer list scrolls. No request resolves a merchant until a visitor chooses it.

## Verification

- Client TypeScript, targeted lint, production-format Expo web export and backend build passed.
- All 32 existing Public Stash/ProductPage backend regressions passed.
- Existing Product Page behavior check passed: stored public offers preserved and public live search/pricing suppressed.
- Offline web action checks passed: first-name/username fallback; namespace routes; single versus multiple buying options; excluded inactive offers; explicit second-offer selection; rejected unknown offer ID; saved country; discovery/no-offer fallbacks; canonical share/copy/cancel/failure.
- Browser checks covered public name/handle/bio, compact five-column desktop pins, two-column mobile pins, keyboard-revealed actions, multiple-merchant sheet, selecting the second merchant, Escape and restored Shop focus. Anonymous detail/save behavior, tabs, pagination and private revocation use the same previously verified paths.
- Responsive checks at 320, 375, 390, 430, 768, 1280 and 1440px passed without horizontal overflow or nested controls. Pagination appended 20 to 25 pins while preserving the first pin in each column. The 320px bottom sheet spans the viewport and retains its 27px heading.
- Screenshots and responsive evidence are in ignored `output/public-stash-pins/`. They use isolated localhost API fixtures, not live user data.

## Limits and native scope

Production purchase/save writes, authenticated owner sessions and paid imagery were not exercised. Profile first names are derived from display names; unusual or business display names may not represent a personal first name. Missing public name/bio safely falls back without blocking the collection. Store prices are stored data and the sheet advises confirming price/availability at the merchant.

No Android/iOS build, install or deployment was run. Existing native UI and shopping/saving implementations are unchanged; only their pure offer-selection/formatting helpers are reused by the web presentation.
