# On-demand place photos — local implementation

Client session retention was subsequently added; see [session reuse report](PLACES_PHOTO_SESSION_REUSE.md) for current behavior and the Google caching-policy distinction.

Verified 2026-11-11. This is an implementation report, not deployment or whole-app legal approval.

## Identity, access and lifecycle

The existing `places_provider_place_unique (provider, provider_place_id)` constraint supplies canonical identity. Separate `user_place_saves` memberships retain ownership. Photo reads never insert/update canonical places, memberships or extraction records, and never run place matching/search.

`GET /places/:placeId/photo?width=128|256|640&importId=<optional UUID>` uses existing verified-session authentication. A caller must own an active save or a non-hidden Find import whose active, resolved source-place row references that exact canonical ID. Inaccessible IDs return the same 404. Existing RLS is unchanged; explicit owner predicates protect the service-role read path. Unresolved results cannot request photos even if inconsistent legacy data contains a place ID.

The provider reads only a verified canonical Google Place ID. Details ID and photo-resource prefix must match it. Selection considers square-crop coverage, minimum resolution and Google's ordering; rejects tiny/extreme-aspect images; and requires the supplied individual-photo Google Maps link. This verifies association with the canonical venue, not the photograph's semantic quality. No additional vision classification is performed.

`PlaceImage` is a reusable resource boundary used by Stash `PlaceCard` and Find detail/activity thumbnails. Its provider resource separates image delivery and attribution from card layout. Source-video play actions remain separate. Unresolved/missing/failed images show the neutral location placeholder, never a source-video poster. Existing card media dimensions, layout tokens, product images, actions and navigation remain intact. Required photo-credit controls are the only additional presentation.

Photos load only on focused, foreground, substantially visible resources. A shared visibility scheduler measures at most 16 mounted resources per 400 ms tick. Client concurrency is three; provider concurrency is eight; per-owner process-local budget is 60 requests/minute. These are containment limits, not distributed quota enforcement. Pending identical requests coalesce; completed responses are not cached. Scrolling a card away clears its temporary resource; revisiting can incur another request. Network/image errors never affect extraction or saving. An image-load failure permits one fresh metadata/media attempt, then placeholder. Provider 404/429/timeout errors do not loop.

## Google content and attribution

Every normal new image uses:

1. Place Details (New), exact field mask `id,photos,attributions`.
2. One selected Place Photo (New) media request, `skipHttpRedirect=true`, bounded dimensions.
3. Direct client download from Google's returned image URL.

The server returns transient image/attribution data with private `no-store` headers. Fetches use `no-store`; Expo Image uses `cachePolicy="none"`. Photo bytes, resource names and short-lived URLs are not persisted in database, Storage, local persistence or logs. In-flight promises and current visible React state are transient only. API keys remain server-side headers. No proxy or new image storage is introduced.

Compact photo displays show Google Maps attribution and open a larger credits viewer containing the unmodified Google Maps logo, provided author names/profile links/avatars, third-party provider attribution, original individual-photo source link and report link when supplied. The original photo is visible uncropped there. Official dark/white logos are bundled branding assets, not cached place photos. Attribution is displayed atomically with the loaded photo.

Official policy references:

- [Places policies and attribution](https://developers.google.com/maps/documentation/places/web-service/policies)
- [Place Photos, expiration and author attribution](https://developers.google.com/maps/documentation/places/web-service/place-photos)
- [Individual photo source links](https://developers.google.com/maps/documentation/places/web-service/maps-links)

## Billing

The photo-only Details mask is **Place Details Essentials (IDs Only)**; it does not request Pro fields such as top-level `displayName` or `googleMapsUri`. Existing extraction/Search field masks are untouched.

At published first paid-volume tiers checked 2026-11-11:

- Global: IDs-only metadata $0; successful photo requests $7/1,000 after the monthly 1,000-request free allowance. Marginal cost per fresh displayed image is **$0.007**, excluding applicable taxes and existing hosting/network charges.
- Eligible India pricing: metadata $0; photo requests $2.10/1,000 after the monthly 7,000-request free allowance. Marginal cost **$0.0021**. Eligibility depends on Google's billing-account/usage rules, not the user's shopping country.
- One image-error renewal can add another photo request: up to $0.014 global / $0.0042 India outside allowances. Failed CDN display after a successful media request can still cost a photo request. Empty metadata does not trigger media retrieval. Opening credits reuses the current URI, without another Places API request, although the client may download bytes again.
- Repeated visits intentionally fetch fresh metadata; do not forecast permanent-cache savings. Same-time coalescing may reduce duplicates but is not a billing guarantee. Existing extraction identity lookup costs are separate and unchanged.

Sources: [field-mask tiers](https://developers.google.com/maps/documentation/places/web-service/place-details), [global pricing](https://developers.google.com/maps/billing-and-pricing/pricing), [India pricing](https://developers.google.com/maps/billing-and-pricing/pricing-india), [SKU definitions](https://developers.google.com/maps/billing-and-pricing/sku-details/places).

## Actual live verification

Two existing owner-scoped canonical Google places were read using existing local credentials. No account identifiers, raw photo references, image URLs or keys were printed/saved.

- Four actual Google Places calls: metadata 200 in 252/128 ms; media 200 in 71/69 ms.
- Two direct image downloads, in memory only: JPEG 200 (24,306 bytes); PNG 200 (131,654 bytes).
- Both returned a photo, Google Maps attribution, original-photo link and one author.
- Bounded end-to-end service/download samples: 693 ms and 516 ms. These are two observations, not a performance benchmark.
- Zero database writes; no photo objects or temporary references persisted. Service-level live verification used Supabase/Google directly; the running API was not restarted. HTTP authentication/ownership behavior was tested with fixtures.

## Verification

- Client/backend TypeScript passed; focused lint passed without errors/warnings; diff whitespace passed.
- Focused backend: **62/62** tests, including 11 photo tests, canonical owner authorization, provider selection/expiry/rate limits, multiple distinct places, source-place isolation, existing saving and merchant/image checks.
- Client focused: **60/61** tests; the existing `stashPlaces.test.ts` expectation for removed `StashCategoryCard` fails. The Stash screen and its prior category removal were not changed by this task.
- Broader backend: **433/434** tests; the existing `ContentSourceService` source-boundary assertion rejects catalog/discovered-table image projection references. This task changes neither that implementation nor assertion.
- Product image gate: all **32** deterministic parity fixtures remain identical.
- Find render checks **1,609**; Places/Create/Profile/Watch render/interaction checks **100**; Share checks **64** passed.
- Added photo rendering scenarios span light/dark, Android/iOS adapters, 320/360/414 widths and larger-font adapters. Assertions cover attribution links/modal, neutral fallbacks, no disk caching, stale callbacks/account changes and visibility gating. SSR/adapters do not prove native scrolling, decoding or accessibility behavior.

Physical-device acceptance remains: Android/iOS scrolling/re-entry under poor networks, screen-reader credit controls, actual light/dark large-font layouts and original-photo/report/profile links. Representative venue-photo subject relevance also needs visual QA. Quota exhaustion, API restrictions/billing eligibility and cold-start conditions require environment monitoring. No claim of complete provider-content coverage or whole-app policy compliance is made.

## Files in this change

New backend: `src/place/photos/{contract.ts,GooglePlacePhotoProvider.ts,PlacePhotoService.ts,routes.ts,photos.test.ts}`. Existing registration: `src/place/routes.ts`.

New client: `components/place/PlaceImage.tsx`, `src/services/{placeImageClient.ts,placeImageClient.test.ts,placeImages.ts}`, `src/ui/useVisibleResource.ts`, `assets/attribution/{google-maps-dark.png,google-maps-white.png}`.

Updated consumers/projections/tests: `components/place/PlaceCard.tsx`, `components/find/{FindActivity.tsx,FindDetailView.tsx}`, `src/ui/{findDashboard.ts,findDetail.ts,findDetailPresentation.test.ts,stashSourceResults.ts,stashSourceResults.test.ts,stashPlaces.test.ts}`, `scripts/{check-find-ui.cjs,check-places-ui.cjs}` and this report. Paths are relative to repository root except the backend source grouping above.

No dependencies, native permissions, migrations, new secrets or infrastructure are required. Uses existing `GOOGLE_PLACES_API_KEY`; its project needs Places API (New) access and applicable billing/quota configuration. Backend restart/deployment and a refreshed client session are needed to run this locally through the app; neither deployment nor a build was performed. No commit/push, historical cleanup or migration application occurred. The intentionally modified Share v2 handoff document remains byte-for-byte preserved.
