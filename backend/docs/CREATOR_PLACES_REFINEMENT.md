# Creator Studio and Places refinement — local verification

Date: 2026-10-28. Scope: existing Create/Places structures, publication feedback and source-video viewing. No build, deployment, migration, worker restart, provider extraction request or dependency installation was performed.

## Design audit and changes

- Create notices had independent hex/RGBA palettes; progress and success content used raw native Text/system weights. These now use shared Text/Inter faces, semantic foregrounds and token surfaces, spacing and line heights.
- Stage cards overrode shared outline-card chrome. The stepper used a foreground token as a filled accent. Create CTAs also used a separate legacy CTA color. These now follow shared card chrome and the primary/onPrimary pair. Modal sheets use an opaque canvas rather than a transparent outline-card fill over the scrim.
- Create's manual spacing/radii and the selected-video Change label were inconsistent with the theme. These use centralized spacing/radius and link tokens. The manual-entry CTA foreground was adjusted along with its shared CTA helper to preserve contrast.
- Places already used shared card chrome, but cards had taller 16:9 media, generous inner padding and section-sized names. They retain the same vertical structure with 2:1 media, tighter token spacing, identity-title names and a semantic caption role for locations. Skeletons use the same proportions. Names, category, uncertainty, status, source attribution and Google Search remain available.
- The single scroll, 01/02/03 stepper, expansion/locking decisions, header, bottom navigation and responsive list container remain intact. Fixed dimensions retained in these components represent media geometry, icon sizes or touch targets; no new palette or UI library was introduced.

## Publication lifecycle: confirmed before/after

Previously, the main Studio called `completeCreateFlow()` as soon as publication returned. Its reset subscriber cleared the success phase, dismissing the success screen. A late draft fetch could restore a published ingest as an active draft because hydration did not recognize the terminal status. The backend ignored the final ingest-status write error and acknowledged rejected ingests as successful publications. A retry could republish an already-published linked Collection and emit its publication events again.

Now:

1. Both Create publication surfaces synchronously guard double taps. A shared, account/draft-scoped request coalescer handles the same pending selection; conflicting selections fail explicitly.
2. Ordinary successful API responses retain existing IDs. Legacy successful acknowledgements without IDs require an owner-scoped persisted `published` status read before success is shown.
3. The backend checks durable Collection linkage and the final ingest status write. Rejected drafts cannot be acknowledged as publications. Published retries return the original Collection/video IDs.
4. A retry after Collection publication but before ingest finalization reuses that Collection, retains ownership/moderation/deletion/creator gates and requires the same selected products. It skips Collection synchronization/publication, avoiding another publication revision/event. Existing video projection repair continues against the linked Collection.
5. Confirmed success removes the local active draft and resume-list entry, fences late reads, refreshes the feed and leaves the success screen visible. The shared flow reset runs only when the user chooses View Feed, View Collection or Create Another (including Android Back's existing success exit).
6. Errors leave the draft and selected products available for retry. Discard also waits for backend confirmation before clearing the local draft. The persisted ingest remains as an authoritative published record; active draft queries exclude it.

No request fields or endpoints were added. Source-video metadata is an additive optional response field.

## Source video

The Places repository already reads a saved content source's canonical URL for image fallback. The response now also exposes it as optional `sourceVideo: { url, thumbnailUrl } | null`, keeping legacy `source`, source arrays, IDs and resolved/unverified identities intact. This adds no database columns or provider calls.

The card uses the actual URL only after strict HTTPS/host validation and existing YouTube/Instagram parsing. The action opens a full-screen modal hosting the existing Reel components. Close, Android Back, navigation blur and account unmount dismiss the host. Existing player HTML/conversion and playback behavior remain unchanged; optional ready/error callbacks serve this host only. No playback analytics were added.

Invalid/missing metadata shows an unavailable label; older API responses without the optional field remain supported. Native load errors or a 20-second readiness timeout show unavailable feedback and Retry/Close. Third-party providers can also display their own private/deleted-video message inside an otherwise loaded embed; the app cannot determine all removal states without additional provider requests. No such requests were added.

## Verification

- Client and backend TypeScript: passed (`npm run typecheck:client`, `npm --prefix backend run typecheck`).
- Focused publication, cache, source URL/metadata, design and lifecycle tests: **35 passed**.
- Existing YouTube/Instagram embed regression tests: **5 passed**. Both embed HTML helper files are byte-identical to the pre-request snapshot.
- Offline Places renders: **16 passed**, covering both themes, doubled typography tokens, loading/empty/error/mixed/unverified/cached-error/refreshing states and source action availability. SSR does not verify native layout or gestures.
- Changed-file ESLint: **0 errors, 6 existing warnings** (existing hook dependencies and an existing array-type declaration).
- Broader 149-file regression sweep: **844 passed**, seven pre-existing assertion failures and five test-runner failures. The five files use `import.meta.dirname` in a CommonJS-transformed test context; temporary copies outside the repo with only ROOT/import-path substitutions ran their **33 assertions successfully**. Four additional refinement tests passed afterward; focused checks were rerun on final code.
- Existing assertion failures: four theme tests expect previous primary/raised/refined experiment values; two tests expect old signed-out Stash copy (`chrome.test.ts`, `contracts.test.ts`); one content-source source-text boundary test rejects existing `catalog_products` wording. The tests and implicated theme/contracts/content-source repository are byte-identical to the pre-request snapshot. No assertion was weakened to hide these failures.
- Source snapshot verification confirms extraction stages, providers/prompts, user-import/content-source processing, Analytics, migrations, app/EAS config, dependency manifests and native directories were preserved.

## Remaining limits and release requirements

- This is locally verified code. The existing running backend and installed APK were not updated. The new optional source metadata and publication safeguards need a separately authorized backend release; native interaction QA needs a future client run/build. No new migration is needed.
- The server guard serializes publication per draft in one API process. A multi-replica deployment needs a durable database claim/transaction for global serialization. An interrupted legacy preparation that fails before saving its Collection link can leave an unpublished orphan; this change blocks publication of that unlinked Collection and does not delete business records. Transactional legacy preparation/cleanup remains separate work.
- Existing Creator Studio description/hashtag input is local-only and absent from the ingest publish request. This refinement does not claim that field is saved or add persistence behavior beyond the requested feedback/source-viewing scope.
- Android/iOS device checks remain: double-tap Publish; network failure and same-draft retry; persistent success and all three exits; no published item in My Drafts after refresh; compact cards at large system fonts; YouTube/Instagram source open, close/back, background/resume, offline/private/deleted source and Retry. No native build was initiated for these checks.

## Files changed in this request

The list below excludes pre-existing Places/extraction/Analytics work preserved in the checkout.

- `app/(tabs)/create/index.tsx`
- `app/(tabs)/create/manual.tsx`
- `app/(tabs)/create/review.tsx`
- `app/(tabs)/stash.tsx`
- `backend/docs/CREATOR_PLACES_REFINEMENT.md`
- `backend/src/place/PlaceService.test.ts`
- `backend/src/place/PlaceService.ts`
- `backend/src/place/SupabasePlaceRepository.ts`
- `backend/src/place/placeListImage.ts`
- `backend/src/publish.ts`
- `backend/src/publishLifecycle.test.ts`
- `backend/src/publishLifecycle.ts`
- `components/InstagramReelItem.tsx`
- `components/YouTubeReelItem.tsx`
- `components/create/CreateInlineNotice.tsx`
- `components/create/CreateStudioLibraryPicker.tsx`
- `components/create/CreateStudioStage.tsx`
- `components/create/CreateStudioStepper.tsx`
- `components/create/PublishConfirmSheet.tsx`
- `components/create/PublishSuccessScreen.tsx`
- `components/create/StagedProgressIndicator.tsx`
- `components/place/PlaceCard.tsx`
- `components/place/PlaceCardSkeleton.tsx`
- `components/place/PlaceSourceVideoModal.tsx`
- `components/place/StashPlacesContent.tsx`
- `components/ui/ActionChoiceRow.tsx`
- `scripts/check-places-ui.cjs`
- `src/services/curation.ts`
- `src/services/publishSingleFlight.test.ts`
- `src/services/publishSingleFlight.ts`
- `src/state/curationDraftStore.test.ts`
- `src/state/curationDraftStore.ts`
- `src/theme/typography.ts`
- `src/types/curation.ts`
- `src/types/placeStash.ts`
- `src/ui/createChrome.test.ts`
- `src/ui/createChrome.ts`
- `src/ui/creatorRefinement.test.ts`
- `src/ui/placeSourceVideo.test.ts`
- `src/ui/placeSourceVideo.ts`
- `src/ui/stashPlaces.ts`
