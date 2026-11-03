# Universal Find Phase 3 — dashboard and navigation

Implemented locally on `codex/share-v2-pilot`, HEAD `570cf49`, on 2026-11-03.
This extends the accepted, uncommitted Phase 1/2 implementation. Stop here for review.
No commit, push, deployment, production migration, data reset, native generation, or release build was performed.

## Product behavior

- Navigation is **Watch · Search · Find · Stash · Profile**. Find has a nested dashboard,
  capture, and detail stack that retains the existing bottom navigation.
- The dashboard adapts the supplied mockup to Mystash's existing typography, theme tokens,
  cards, skeletons, notification entry, and tab bar. It uses global **Processing** and **Completed**
  counts, plus **Needs Attention** when relevant. Counts come from the server, including unloaded records.
- The default completed view is **Recently Found**, with two image cards, then older history rows.
  Status filters and **All captures** expose the rest of history. There is no dashboard Saved counter.
- Automatic extraction-to-Stash saving remains intact. Capture acknowledgement confirms receipt;
  it does not claim extraction or saving succeeded. No mandatory selection or review step was introduced.
- URL capture accepts the existing supported shared-link formats and uses the existing `/imports`
  submission flow. It handles validation, pending submission, duplicate receipt, authentication,
  and connection errors. Unconfirmed submission retains the user's input. No offline queue is invented.
- Screenshot and Camera are explicitly disabled and labeled **Not available yet**. Their placeholders
  are omitted with enlarged text to keep the capture dock usable. No image permission, upload,
  gallery, camera, private-storage, or extraction infrastructure was added.
- Find detail separates identified results from current Stash membership. It handles processing,
  delayed work, partial/failed extraction, failed saving, completed/empty results, refresh errors,
  unavailable records, and malformed links. Existing loaded content survives refresh errors.
- Detail supports the original link, product navigation with source attribution, My Stash/Places,
  explicit extraction/save retries, removal/restoration, optional private intent, and optional similar
  products. Similar options remain explicitly labeled; previously accepted options remain manageable
  when new suggestion generation is disabled. Removal can record a tombstone before initial saving finishes.
- Removing a capture hides history after confirmation and leaves Stash items intact. Removing a result
  changes the existing global Stash membership; its evidence stays visible and restoration is explicit.
- Creator Studio is prominently accessible directly below the personal Profile header. Existing Create,
  manual, review, draft, and publishing routes remain. A direct Studio entry has a Profile back destination.
- Search retains blended product, creator, and collection discovery, autocomplete, shelves, and result
  navigation. Its Paste URL option opens the dedicated Find capture screen. Its existing activity summary
  remains; See all opens all Find captures. `/shares` redirects to all Find history. The existing
  `mystash://import` acknowledgement and native pending-share behavior are retained; its CTA opens Find.

## Reliability and platform boundaries

History uses the Phase 2 keyset cursor and authoritative outcome contract. Head refresh preserves loaded
older pages and their cursor, merges by ID, and refreshes global counts. Foreground polling refreshes all
loaded nonterminal records in batches bounded to 100 IDs, including older pages. Focus/manual refresh
also checks terminal loaded records for changes or hiding on another device. Filter, account, navigation,
and overlapping page/refresh responses are fenced. A failed refresh retains the previous snapshot.

Polling stops on blur/background. Active loaded work polls at five seconds; unloaded global work or
recoverable errors use twenty seconds. Idle terminal history does not poll. These are foreground reads,
not new background jobs. Large-history server counting costs and live keyset pagination semantics remain
as documented in Phase 2; this phase does not introduce a database snapshot across pages.

Detail serializes mutations and refreshes authoritative membership after an action, including uncertain
acknowledgements. Stale reads/acknowledgements cannot cross account or focus boundaries. Private intent
drafts survive background refresh and revision conflicts until explicitly discarded or saved. Similar-option
requests have separate owner, record, focus, and request-generation checks.

Find refreshes the shared Stash count when memberships change, including automatic saving on an open
detail screen. The shared Cart reader now rejects stale owner/read responses, masks another account's
snapshot immediately, clears it before a new account read, exposes initial read errors, and fences late
optimistic rollback. Capture and Cart reads check the expected authenticated owner before and after transport.
Server ownership checks, authenticated routes, RLS, and Phase 1 removal/restoration RPCs are unchanged.

The installed React Native AbortSignal polyfill does not implement static `timeout()`. Find, capture,
Cart reads, and existing Share review transport now use a small AbortController/timer helper that clears
its timer in `finally`. Tests exercise the installed native polyfill rather than relying solely on Node's
more complete AbortSignal implementation. Existing endpoint and payload contracts remain.

Find uses the existing safe-area TopBar and tab bar, adds left/right inset padding, wraps large labels,
and provides 48-point action targets. Featured cards stack at narrow widths/enlarged text. Capture handles
the keyboard on Android/iOS; detail adjusts keyboard insets for optional note editing. Controls expose
labels, selected/disabled/busy state, and status/error announcements. Skeletons reuse reduced-motion support.

## Verification

- Client TypeScript and backend TypeScript pass with `--noEmit`.
- Repository `npm run lint`: **0 errors, 23 existing warnings**. Explicit lint of the new render harness
  and affected modules passes. JavaScript syntax and tracked diff whitespace checks pass.
- **56/56 focused tests** across nine Find/controller/transport/navigation/Share/loading test files pass.
  The actual Find client is integrated with history/detail controllers over an offline HTTP adapter:
  1,205 records paginate without duplicates, global counts include unloaded rows, opaque cursors are retained,
  batch refresh is bounded, older work completes, hidden records disappear, and membership identity tokens
  reach removal/restoration actions. Additional tests cover stale pages, account/filter/blur races, failed
  refresh preservation, serialized actions/conflicts, missing identities, duplicate/failed capture, and timeouts.
- `node scripts/check-find-ui.cjs`: **304 checks pass**, covering both themes, Android/iOS adapters,
  widths 320/390/430, enlarged text, state variants, navigation/action callbacks, real capture/Cart/Share
  transports with injected sessions, and the installed native AbortController polyfill.
- Existing Share render checks: **32 pass**. Existing Places/Create/Profile render checks: **60 pass**.
- Offline HTML fixtures were inspected in headless Chrome using a temporary profile. Light/dark dashboard,
  detail, capture, and the enlarged-text dashboard screenshots have no measured horizontal overflow.
  Enlarged-text crowding found during inspection was corrected. Fixtures use synthetic thumbnails/icon
  adapters and local Inter fonts; they do not contact the app, backend, or extraction services.
- Broad client run: **553/565 passed**, with the same twelve previously documented failures below.
  A subsequently added missing-identity regression is included in the final 56-test focused run.
- Broad backend run from `backend`: **1152/1156 passed**. Three existing assertion mismatches and one
  working-directory-dependent test failed, detailed below. The directory-dependent test passes in its
  full **9/9** file when run from the repository root. No backend source changed during Phase 3.
- No SQL harness was rerun in Phase 3 because database/API/worker source and both prepared migrations
  remain unchanged. Their local PostgreSQL/authorization/concurrency verification is recorded in Phase 2.

Reproduce focused tests from the repository root:

```sh
node --import ./backend/node_modules/tsx/dist/loader.mjs --test \
  src/state/findControllers.test.ts src/state/findIntegration.test.ts \
  src/state/ownerReadFence.test.ts src/ui/find.test.ts \
  src/services/findClient.test.ts src/services/requestTimeout.test.ts \
  src/ui/searchDiscoverUx.test.ts src/ui/skeletonLoading.test.ts src/ui/shareImport.test.ts
```

Render with `FIND_RENDER_DIR=/private/tmp/mystash-find-phase3-ui node scripts/check-find-ui.cjs`.
This writes disposable offline fixtures only. Raw test logs are under `/private/tmp/mystash-find-phase3-*`.

### Existing failures and harness limitations

Client failures retained without unrelated fixes:

1. `src/notifications/linking.test.ts`: promo fixture is missing required campaign fields (one failure).
2. `src/theme/tokens.test.ts`: four assertions expect superseded theme defaults.
3. `src/ui/chrome.test.ts` and `src/ui/contracts.test.ts`: two assertions expect older signed-out Stash copy.
   The tab-navigation expectations in chrome.test were updated for Find; the unrelated copy assertion remains.
4. Five files cannot initialize with the current TS/CommonJS harness because `import.meta.dirname` is
   undefined: `reelLikeEngagement`, `collectionProductCard`, `collectionTileNavigation`, `feedShop`, and
   `searchReelNavigation` tests. New Find tests do not require that harness feature.

Backend assertion mismatches retained:

1. `backend/src/content-source/ContentSourceService.test.ts`: the source boundary regex rejects the
   existing catalog/discovered image projection.
2. `backend/src/config/pipeline.test.ts`: expects `places-v2`, while the existing cache scope is
   `places-v3-progressive`.
3. `backend/src/prompts/productReasoner.test.ts`: its static regex expects the older progressive reasoner
   invocation. The test and directly implicated implementation match HEAD for all three findings.

`backend/src/workers/ingestionRuntime.test.ts` assumes repository-root paths; the rest of the normal backend
test command includes tests assuming backend-relative paths. Its root-directory rerun passes all nine tests.
An initial root-directory broad invocation also produced the reciprocal path error in productReasoner;
the backend-directory run reveals the assertion mismatch described above. Two local HTTP notification
fixtures initially hit sandbox `listen EPERM`; the permitted rerun passes those fixtures. These environment
failures are not treated as application regressions. RN Web also emits existing shadow/pointerEvents deprecations.

## Review and release limits

This is local Phase 3 implementation, not release approval. RN Web adapters and screenshots do not verify
native stack gestures, OS keyboard behavior, hardware safe areas, VoiceOver/TalkBack, image loading, or
physical-device performance. Android/iOS device acceptance and long-history/large-result scrolling remain
release checks. No native app or final APK/IPA was built in this phase.

The UI requires the accepted Phase 1/2 schema/API/worker source to be rolled out together. The currently
deployed Share v2 backend alone is not evidence that the new Find endpoints/schema are available. Neither
prepared migration has been applied here. Deployment/migration/build approval is still required. Render
sleep/queue durability and the existing YouTube downloader limitation remain. Server counts are authoritative
but their production cost has not been load-benchmarked. Existing regression failures remain unresolved.

All 82 pre-existing dirty files remain on disk. Phase 3 extends only `src/ui/shareActivity.ts` and
`src/services/findClient.ts` among those dirty candidates; every other candidate retains its starting hash.
The original `backend/docs/SHARE_TO_MYSTASH_V2.md` SHA256 remains
`9c1d9ade39a3d63b1bb16a1bc8926dabc9f08fc468a2651c7fdb579ca9eb9a43`.
Ignored local configuration, dependencies, generated native output, and private evidence remain untouched.
Nothing is staged. Branch and HEAD remain unchanged.

## Phase 3 source scope

New Find screens: `app/(tabs)/find/{_layout,index,capture,[findId]}.tsx`.
New components: `components/find/{FindDashboard,FindCard,FindImage,FindCaptureActions,FindDetailView,FindIntentEditor,FindNotificationButton}.tsx`.
New hooks: `src/hooks/{useFindHistory,useFindDetail,useFindCapture}.ts`.
New state modules: `src/state/{findHistoryController,findDetailController,findCaptureController,ownerReadFence}.ts`.
New helpers: `src/ui/{find,findDetail,findTestFixtures}.ts` and `src/services/requestTimeout.ts`.

Existing modules extended: `app/(tabs)/create/_layout.tsx`, `app/(tabs)/search.tsx`, `app/import.tsx`,
`app/shares.tsx`, `components/chrome/AppTabBar.tsx`, `components/profile/PersonalProfile.tsx`,
`components/search/YourActivitySection.tsx`, `components/ui/ActionButton.tsx`, `contexts/CartContext.tsx`,
`src/services/{findClient,cartApi,userImportApi,shareReviewApi}.ts`, and `src/ui/{chrome,shareActivity}.ts`.

Tests/validation: `src/state/{findControllers,findIntegration,ownerReadFence}.test.ts`,
`src/services/requestTimeout.test.ts`, `src/ui/find.test.ts`, updated
`src/ui/{chrome,searchDiscoverUx,shareImport,skeletonLoading}.test.ts`, and `scripts/check-find-ui.cjs`.
This report is the only new repository documentation. No Phase 4/5 implementation is included.
