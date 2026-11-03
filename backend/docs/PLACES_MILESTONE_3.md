# Places Milestone 3 — unified Stash experience

Deployment update (2026-10-28): the user subsequently approved the two Places migrations,
backend restart, and an internal Android APK. See [device-test release](./PLACES_DEVICE_TEST_RELEASE.md).
The local-only statements below describe the original milestone implementation.

Implemented locally on 2026-10-28. No deployment, native/cloud build, provider call,
dependency installation, production tracking change, or database migration.

## Result

Stash → Places now presents one recent-save list containing both canonical places
and unverified leads, rather than separate Places and Leads sections. It consumes
the existing mixed `GET /places` response and preserves its order, Google Search
destinations, and distinct backend identities. No API change is necessary.

The presentation adapter deduplicates canonical IDs and repeated lead identities.
A stale lead can collapse into a canonical card only when an explicit save ID or
source-hypothesis link proves the relationship. Conflicting canonical identities,
similar names, and identical location labels never imply a merge. Source/import
edges are retained without mutating API payloads. Save IDs keep React keys stable
through promotion; legacy responses retain their original fallback keys. Existing
entity IDs remain the IDs used for Analytics and navigation. Resolution status is
normalized explicitly even for older responses without save/provenance fields.

## Design

- Uses existing Titanium/Nebula tokens, Inter typography, outline-card surfaces,
  `ActionButton`, skeleton blocks, and the existing Profile content tabs. No global
  token or shared button changes, new UI library, or new assets.
- Consistent inset media, rounded card surfaces, clearer place-name hierarchy,
  location rows, and a quiet “Unverified” badge with the existing uncertainty copy.
  Unverified cards retain full text contrast. Known canonical addresses can supply
  location text when locality is absent; absent fields remain absent.
- Source thumbnails say “Saved video preview”; extracted frames say “Saved video
  frame”. They are not presented as photos of the venue. Multiple-source attribution
  counts distinct source videos rather than imports. Existing provider photos remain
  supported when present; none are fetched or fabricated.
- Missing or failed images use a themed location placeholder. Thumbnail fades respect
  the existing reduced-motion hook and timing tokens.
- Google Search remains the supported action. No Maps, new filters, ratings,
  source-video navigation, place removal, or other unsupported capabilities were added.
- A single virtualized `FlatList` replaces eager rendering of every Places card.
  Initial and batch rendering are limited to four items with a five-viewport window.
  Content width is capped at 680 points, with shared mobile gutters and bottom-tab
  clearance. The same component serves Android and iOS without platform forks.
- Initial/idle loading has matching skeletons and an accessible busy state. Empty
  and failed loads have distinct cards; errors are never displayed as empty results.
  Refresh failures keep cached cards visible with Retry. Pull-to-refresh, refresh
  ownership, account/request fencing, ingestion completion refresh, and external
  navigation stay screen-owned. Error copy is concise rather than raw server text.

## Preserved scope

The existing header, bottom navigation, Activity section, product Stash, purchase
confirmation, auth and navigation paths remain. The existing `place.impression`
qualified-exposure hook and `place.outbound_requested` action retain their event
names, entity types/IDs, surface, and destination kind. No Analytics source,
configuration or privacy controls were changed. Pre-existing Creator Studio and
Places Milestones 1–2 files outside this milestone were checked against pre-edit
hashes and preserved.

This UI relies on the existing Milestone 2 provenance/promotion implementation for
authoritative persistence. It does not replace canonical places and leads with a
single database identity. Milestones 1–2's pending migrations and worker rollout
requirements still apply when those backend changes are eventually released.

## Local verification

- Relevant regression run: 551 cases, 549 pass, two pre-existing failures, no skips.
  Includes Places, imports, content-source processing, product resolution, offline
  extraction replay, Analytics/privacy, Android sharing, Creator flow/chrome,
  authentication, product Stash, loading states, request scoping and the new unified
  adapter regressions.
- The existing failures remain `ContentSourceService scope` (a source-text assertion
  rejecting pre-existing product-table references) and `chrome.test.ts` (older
  signed-out Stash copy). No unrelated implementation or assertions were changed
  to conceal them.
- New adapter regressions cover mixed order, empty inputs, canonical and lead
  deduplication, both promotion orders, source preservation, immutable payloads,
  ambiguous identity conflicts, same-name places, legacy responses, stable save
  keys, source-video captions, known-address fallback and unchanged Analytics IDs.
- `node scripts/check-places-ui.cjs`: 16 actual-component SSR checks across idle,
  loading, empty, initial error, mixed, unverified, cached-error and refreshing states
  in both themes. They use a 320-point container and doubled typography tokens,
  existing React Native Web/React dependencies, static native-adapter substitutes,
  and blocked network/Analytics calls. These checks assert rendered content and
  state separation, not actual browser layout, native font scaling or gestures.
- Client and backend TypeScript checks pass. Focused lint on all milestone files
  has no errors or warnings. App-wide lint has no errors and the existing 23 warnings.
  Whitespace checks pass.
- An initial narrow-browser fixture rendered mixed cards. The localhost preview
  restart was declined, so browser verification stopped. The full visual matrix,
  image-error interaction, Android/iOS pull-to-refresh, screen-reader behavior,
  large-text layout and device rendering remain unverified. No native tooling was
  installed, no server was restarted after the decline, and no builds were run.

Repeat the focused checks from the repository root:

```sh
npm run typecheck:client
npm --prefix backend run typecheck
node scripts/check-places-ui.cjs
TSX_DISABLE_CACHE=1 LOG_LEVEL=silent node --import ./backend/node_modules/tsx/dist/loader.mjs --test src/ui/unifiedPlaces.test.ts src/ui/stashPlaces.test.ts src/ui/placesRequestScope.test.ts src/ui/importResultReporting.test.ts src/ui/skeletonLoading.test.ts
```

## Files changed in this milestone

- `app/(tabs)/stash.tsx` — delegates the Places body; product/navigation paths preserved.
- `components/place/StashPlacesContent.tsx` — unified list and loading/empty/error/refresh surfaces.
- `components/place/PlaceCard.tsx` — premium card, uncertainty/source labels, image fallback.
- `components/place/PlaceCardSkeleton.tsx` — matching card geometry.
- `src/ui/stashPlaces.ts` — identity-safe presentation adapter and display fields.
- `src/ui/stashPlaces.test.ts` — updated unified-list and card contracts.
- `src/ui/unifiedPlaces.test.ts` — identity/provenance/promotion regressions.
- `src/ui/skeletonLoading.test.ts` — verifies loading through the extracted component.
- `scripts/check-places-ui.cjs` — offline component render checks.
- `backend/docs/PLACES_MILESTONE_3.md` — this implementation record.

No additional database changes require deployment for Milestone 3.
