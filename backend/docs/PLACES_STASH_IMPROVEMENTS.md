# Places Stash improvements — local implementation

Implemented against the current shared Android/iOS checkout. No deployment,
service restart, migration, native build, dependency installation, partner
integration, or paid AI/provider call was performed.

## Metadata and read model

- The existing video extraction adapter carries returned source metadata into
  user-import processing. Missing content-source title/thumbnail fields are filled
  from that metadata, including cache hits. Populated fields are preserved.
  Invalid URLs are ignored. Metadata write failure does not invalidate extraction;
  existing stale-worker assertions and database fencing remain in place.
- Historical Places reads obtain missing thumbnails from the newest existing cache
  metadata for the exact platform/video identity. Only the metadata JSON subtree is
  selected. GET never writes/backfills sources or reruns extraction. Exact stored
  video thumbnails remain a fallback; they are labeled source posters, not venue
  photos or proof of extracted frames. No provider photo lookup is introduced.
- Save/hypothesis/canonical/source/media reads are batched with bounded ID lists
  and stable PostgREST range iteration. In the 12-save/eight-source fixture, six
  SELECTs replace the audit's code-derived 39-query path. This measures query
  count using the mock repository, not deployed latency.
- DTOs retain raw/extracted categories and category origin, timestamps, stable
  save/entity identities, and all user-authorized source edges with actual video
  URLs/posters. Canonical rows can fall back to an extracted category when the
  identity provider omitted it. These additions do not imply verification.

## Conservative grouping and categories

- No records are merged/deleted and no resolver gate or prompt is changed.
  A presentation group requires one user/source, exact normalized name/category,
  matching grounded evidence (e.g. the same quoted video title), shared city and
  country, and a noncontradictory locality/address refinement. An incomplete mention
  cannot bridge two conflicting branches. Uncertain or cross-source same-name
  matches remain separate. The audited Buckingham Palace title/locality refinement
  is covered by regression fixtures.
- Legacy API responses retain every underlying row. Presentation-group hints let
  the client show one unverified card while retaining every save and provenance edge.
  Actual entity IDs, not display-group IDs, are used for existing Analytics events.
- Categories use an explicit display-only alias map. Accommodation becomes Stays,
  not Hotels; unknown labels and Brewery remain Other. No classification is inferred
  from a place name and no additional model call is made.

## Shared UI

- The Places home reuses StashCategoryCard for real-image category collages/counts
  and Product related-card geometry for a two-column Recently stashed shelf (up to
  eight items). Category selections use the same virtualized grid, with Back and
  Android hardware-back support. Narrow/large-font layouts use one column.
- Inter semantic typography, token surfaces/radii/spacing/colors, shared Product
  insets, and 44-point action targets are preserved. Product card dimensions and
  default product category behavior are unchanged.
- Cards show name, available location, Google Search, source-video action when
  available, and one uncertainty indicator. Repetitive no-photo/confirmation/source
  sentences are not rendered. Images use memory/disk caching and try associated
  source posters on failure before a quiet placeholder.
- The existing source modal hosts the same YouTube/Instagram players. Multiple
  associated videos can be selected inside that host. Close/Android Back, inactive
  playback, unavailable/retry states, and stale-player callback fencing are covered.
- The destination action slot is presentation-neutral. Google Search is still the
  only supported destination and emits the unchanged consent-controlled Analytics
  event. No partner URLs, integrations, redirect infrastructure, or new metrics exist.

## API compatibility and pagination limitation

GET /places without query parameters keeps the existing full-list behavior and
legacy fields; new fields are additive. Opt-in ?limit=1..100&cursor=... pagination
returns complete display groups together, nextCursor, raw itemCount, and distinct
displayItemCount. Invalid/stale cursors return 400 and require refresh. Authentication
and email verification remain unchanged. Source metadata is derived from owned
saves/provenance, including hidden import history, not the latest-20-import shortcut.

Pagination currently bounds the response, not the initial authorized-data scan:
projection/grouping occurs before slicing so refinements cannot straddle pages and
counts remain correct. The current client deliberately uses the full batched list
for complete category shelves/counts. A future SQL projection/keyset read model may
be warranted for very large stashes; no schema migration is needed for this release.

## Verification and release dependencies

- 267 fixture regressions passed: Places repository/service/routes, metadata
  propagation, recorded extraction-quality/provider-call-budget replay, source
  mapping, account switching, publication protections, and Analytics privacy.
- 52 offline render/interaction checks passed across Titanium/Nebula, phone widths,
  enlarged typography, empty/error/loading states, category selection/back, image
  fallback, multi-source selection, unavailable/retry, Close/Back, and stale events.
- Backend TypeScript passes. Client TypeScript retains only the two pre-existing
  TS2345 route errors in CreatorAnalyticsScreen.tsx:147 and LegacyAnalyticsScreen.tsx:150.
- Lint has zero errors and the same 23 pre-existing warnings. Diff whitespace checks pass.

No new dependencies or migrations. Existing Places/provenance tables from the prior
approved Places migrations are required. After review, API and ingestion-worker code
must be released/restarted and the shared client rebuilt or run through its normal
development workflow. None of those release actions was performed here. Until then,
the running backend and installed APK retain their existing behavior. Native device
layout/image loading and real private/deleted video playback still need device QA.

## Files changed in this implementation

This list excludes the pre-existing dirty work preserved in the checkout.

- `backend/docs/PLACES_STASH_IMPROVEMENTS.md`
- `backend/src/content-source/domain/types.ts`
- `backend/src/content-source/processing/ContentSourceProcessor.test.ts`
- `backend/src/content-source/processing/ContentSourceProcessor.ts`
- `backend/src/content-source/processing/videoAdapter.test.ts`
- `backend/src/content-source/processing/videoAdapter.ts`
- `backend/src/place/InMemoryPlaceRepository.ts`
- `backend/src/place/PlaceRepository.ts`
- `backend/src/place/PlaceService.test.ts`
- `backend/src/place/PlaceService.ts`
- `backend/src/place/SupabasePlaceRepository.ts`
- `backend/src/place/placePresentationGroups.ts`
- `backend/src/place/routes.test.ts`
- `backend/src/place/routes.ts`
- `backend/src/place/stashProjection.test.ts`
- `components/commerce/ProductCard.tsx`
- `components/commerce/StashCategoryCard.tsx`
- `components/place/PlaceCard.tsx`
- `components/place/PlaceCardSkeleton.tsx`
- `components/place/PlaceSourceVideoModal.tsx`
- `components/place/StashPlacesContent.tsx`
- `scripts/check-places-ui.cjs`
- `src/services/placesApi.ts`
- `src/types/placeStash.ts`
- `src/ui/placeCategories.ts`
- `src/ui/placeSourceVideo.test.ts`
- `src/ui/placeSourceVideo.ts`
- `src/ui/placesHome.test.ts`
- `src/ui/productCardLayout.ts`
- `src/ui/stashPlaces.test.ts`
- `src/ui/stashPlaces.ts`
