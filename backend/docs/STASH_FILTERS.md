# Stash Products and Places — filters and card presentation

Implemented locally on 2026-10-30. No deployment, API/worker restart, migration,
backfill, extraction/provider call, dependency installation, or native/cloud build.

## Existing Recent behavior and resulting behavior

Both discovery helpers (`buildStashHome` and `buildPlacesHome`) returned a newest-first
preview capped at eight items. The screens rendered that preview with no continuation.
Category views already used the full fetched category lists.

The Stash Recent sections now select from the complete fetched saved datasets,
independently of those eight-item discovery previews. The helper previews are retained
for existing consumers elsewhere. All shows the complete list; selecting a category
filters before rendering and never filters only the latest eight or one cursor page.
Real added timestamps determine newest-first order, ties retain source order, and
undated legacy items retain relative API order after dated entries. No source arrays
or records are mutated. There is no new UI page size or hidden Recent truncation.

## Filter controls and layouts

- Shared StashFilterBar provides All plus only categories represented in the current
  saved data. All has a distinct null identity, including when a real category is
  named All. Missing selections safely resolve to All.
- Capsule shape, thin neutral borders, small native shadow/elevation, a soft selected
  fill, outline icons, Inter typography, spacing and press feedback use centralized
  theme values. Chip styling is isolated from existing card chrome.
- The bar scrolls horizontally in a single non-wrapping row, retains full labels at
  large text sizes, and exposes selected accessibility state and 44-point targets.
- Product and Place Recent filters are independent of category-collage navigation.
  Existing category collages, two-column Product grid renderer, Place card media
  geometry, category views, source viewer, and Android/iOS navigation are retained.
  Places keeps its existing narrow/large-font single-column accessibility layout.
- The existing Products ScrollView/grid renderer is retained; this change does not
  introduce a new virtualized Products layout. Places remains virtualized.

## Places presentation only

The visible Source video label is removed from cards. The same play icon, on-media
surface, accessible Source video label, and at least 44-by-44 touch target remain.
Embedded YouTube/Instagram playback, multi-source selection and Close/Back are intact.

Verification/uncertainty badges are not rendered on Stash Place cards. Backend
resolution fields, frontend raw data, resolver behavior, and existing Analytics entity
IDs/events are unchanged. No Place becomes verified as a consequence of presentation.

A type/category line appears immediately below available address/location text. It
uses the actual category and extractedCategory values, deduplicates matching labels,
and formats explicit multiple types with a middle dot. Brewery is not expanded into
Restaurant/Bar; missing types are omitted. No additional provider types are fabricated
or requested. Older APIs that return one category can display only that known value.

## Minimal full-dataset query/pagination adjustments

- The Places client follows returned nextCursor values before filtering. Initial
  legacy full-list responses still require only one request. Requests use one pinned
  bearer token, retain all distinct save identities, and stop when the owner/request
  generation changes. Later-page failures or repeated cursors fail rather than
  exposing a partial dataset as complete.
- Cart membership reads now use stable, owner-scoped PostgREST ranges instead of
  silently stopping at the database response cap. Legacy Places save/provenance
  readers also exhaust stable ranges; the newer batched Places snapshot was already
  range-aware. No API contract, schema, write path or extraction logic changes.
- These repository query corrections remain local. They need a separately approved
  backend release to affect stashes larger than the running API/database row cap.
  This task does not deploy them or replace the running thumbnail-only API release.

## Verification

- 168 focused regressions pass, including full saved lists beyond eight items,
  later-page category matches, 1,101-row repository reads, stale-account cancellation,
  category text, raw resolution preservation, existing Cart/Places behavior,
  publication protections and Analytics privacy.
- 60 offline render/interaction checks pass across Titanium/Nebula and enlarged
  typography: chip selection/All reset, horizontal non-wrapping controls, older
  category matches, unchanged collages, icon-only playback targets, no badges,
  image fallback and existing modal Close/Back/retry behavior.
- Backend TypeScript passes. Client TypeScript has only the two pre-existing TS2345
  routing errors at CreatorAnalyticsScreen.tsx:147 and LegacyAnalyticsScreen.tsx:150.
- Lint has zero errors and the same 23 existing warnings. Diff whitespace checks pass.
- React Native Web reports its native-shadow-property deprecation notice during
  offline rendering; native shadow/elevation props retain Android/iOS compatibility.
  Native pixel layout, scrolling gestures and device playback still need device QA.

## Files changed in this task

Pre-existing dirty work is preserved; this list contains only this task's changes.

- `app/(tabs)/stash.tsx`
- `backend/docs/STASH_FILTERS.md`
- `backend/src/cart/SupabaseCartRepository.ts`
- `backend/src/cart/stashPagination.test.ts`
- `backend/src/place/SupabasePlaceRepository.ts`
- `backend/src/place/stashProjection.test.ts`
- `components/commerce/StashFilterBar.tsx`
- `components/commerce/StashRecentProducts.tsx`
- `components/place/PlaceCard.tsx`
- `components/place/StashPlacesContent.tsx`
- `scripts/check-places-ui.cjs`
- `src/services/placesApi.ts`
- `src/services/stashPageCollection.test.ts`
- `src/services/stashPageCollection.ts`
- `src/theme/tokens.ts`
- `src/ui/bag.ts`
- `src/ui/stashFilters.test.ts`
- `src/ui/stashFilters.ts`
- `src/ui/stashPlaces.test.ts`
- `src/ui/stashPlaces.ts`
