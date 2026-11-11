# PlaceImage session reuse and efficient loading

Local implementation, 2026-11-11. Supersedes the no-completed-cache client behavior in PLACES_PHOTO_INTEGRATION.md. No deployment, migration, build, commit or live Google request was performed for this change.

## Google policy distinction

This implements the explicitly requested session cache. Memory-only storage is still caching; this report does not claim it is permitted by Google's standard Places agreement. Confirm permission under the applicable agreement before enabling this Google-photo reuse in a distributed build. Set `EXPO_PUBLIC_GOOGLE_PLACE_PHOTO_SESSION_REUSE=false` to disable completed Google resource retention. The user-requested local default enables it. `allowSessionReuse(source)` keeps the decision isolated from future licensed providers.

Official references: [Places caching/attribution policies](https://developers.google.com/maps/documentation/places/web-service/policies), [Place Photos](https://developers.google.com/maps/documentation/places/web-service/place-photos).

## What is reused

The client downloads the selected photo into memory, encodes the bytes as a data URI and retains them with the photographer/source attribution. It does not merely cache a short-lived CDN URL. Remounting a card renders the retained bytes, so no metadata, media or CDN request is needed on a hit. Existing native `Image` renders the data URI with `cachePolicy="none"`. The installed Expo Image `loadAsync` loader can use disk caching; it is deliberately not used. No native prefetch, file write, Supabase Storage, AsyncStorage or SQLite was added.

The LRU key is source + verified canonical Google Place ID + size variant. A bounded alias maps the app's canonical place ID to that key. Google identity is returned only after the existing owner-scoped authorization check. Cache delivery checks the current authenticated account; account changes/sign-out clear resources and abort outstanding work. Token refresh and tab navigation do not clear them. Memory warnings clear the managed pool; process termination naturally releases all bytes. No cross-account image session is retained.

The pool is bounded to 32 entries and 24 MiB of conservatively estimated memory. Estimates include UTF-16 base64 size, requested-size RGBA decode allowance and credits. These are managed-pool estimates, not measurements of the whole native heap: visible views, temporary network buffers, decoder copies and short-lived JS values add overhead. An individual response over 4 MiB is rejected; a resource larger than the configured pool is displayed without retention. The cache cannot promise an image survives eviction, memory pressure or session termination. A different size variant can require a new photo request.

## Demand and retry behavior

- A 300 ms visibility debounce precedes acquisition. Queued work is cancelled when a card leaves view. At most three network operations run concurrently. Cache hits bypass this queue.
- A 600 ms offscreen grace period avoids blanking images during small visibility changes, then releases the component's local bytes; the LRU remains available for later visits.
- On-layout width × device pixel density chooses the existing 128/256/640 variants within each caller's cap. This reduces transfer/decode work; it does not lower Google's per-photo SKU price.
- Concurrent requests for the same owner/canonical place/variant coalesce across Find import contexts. Backend in-flight coalescing still operates by Google ID and size; there is no server completed-image cache.
- Offline/unreachable native fetch errors do not retry immediately. Native fetch cannot reliably distinguish offline from every network failure; the code conservatively treats generic fetch TypeErrors as offline/unreachable. There is no new connectivity dependency or continuous native network monitor. Foreground/visibility re-entry permits another attempt.
- Timeout and transient failures use bounded 500/1,000 ms backoff, maximum three attempts. Long `Retry-After` responses defer further work through a bounded cooldown instead of keeping a card waiting. Only resource-expiry failures discard the current URI and request fresh metadata. A transient CDN failure retries the same URI, avoiding another paid media call. Request cancellation interrupts waiting/backoff/download work. Timeouts cover response-body reading as well as headers.
- Structured safe provider errors distinguish expiry, rate limiting, timeouts and transient errors. Empty photos remain a normal placeholder. Existing authentication, canonical identity, private membership queries and save/extraction behavior are unchanged.

## Monitoring and measured fixture result

`placeImages.metrics()` exposes local, aggregate counters: hits/misses, coalesced requests, estimated avoided API requests, endpoint requests, image downloads, bytes-ready latency, render-ready latency, retries, cancellations, typed failures, entries, estimated memory and evictions. It does not emit user analytics or log URLs/IDs. Avoided-request counts describe reuse/coalescing, not an invoice reconciliation.

The backend provider separately counts actual metadata requests, media requests, successful media responses, coalescing and failures. Safe aggregate snapshots are emitted at debug level as `place.photo_counters`; enable debug logging only when needed. Successful media responses are the useful billing proxy, not a guarantee about the final Google bill.

Measured deterministic replay: **20 views of one place/variant → 1 cold endpoint request, 1 image download, 19 cache hits and 19 avoided endpoint requests**. Each cold provider success normally performs one metadata request and one photo-media request. No live provider calls or billing savings were measured in this task; fixture timing is not a mobile performance benchmark.

## Verification

- Client/backend TypeScript; focused ESLint and diff whitespace checks pass.
- Client focused tests: 57/57, including 14 cache/loading tests for real retained bytes, remount/context reuse, size separation, LRU limits, eviction, oversized entries, ownership changes, cancellation, concurrency, offline/expiry/transient/rate-limit handling, policy controls, base64 parity, sizing, debounce and cache-hit queue bypass.
- Backend focused tests: 54/54, including 12 photo/provider tests and the existing 32-product-image parity gate.
- Find render checks: 1,609. Places/Create/Profile/Watch render/interaction checks: 100. Share render checks: 64.
- Existing broader-suite failures documented previously (removed Stash Categories assertion and the content-source image-projection boundary assertion) are outside this change. No affected production assertion was removed to make this work pass.

Physical-device checks remain: Android/iOS data-URI decoding and native disk behavior, long-scroll memory/GC profiling, fast tab switching, large-font/theme attribution layout, network loss/reconnect, memory-warning handling and actual photo relevance. The configured pool limits do not replace a native memory profile. Existing API/mobile sessions were not restarted.

## Files

- New helper: `src/services/placeImageMemory.ts`.
- Client/session manager/tests: `src/services/placeImageClient.ts`, `src/services/placeImages.ts`, `src/services/placeImageClient.test.ts`.
- Reusable display: `components/place/PlaceImage.tsx`.
- Additive photo response/error/metrics support: `backend/src/place/photos/contract.ts`, `GooglePlacePhotoProvider.ts`, `PlacePhotoService.ts`, `photos.test.ts`; route wiring `backend/src/place/routes.ts`.
- Render assertions: `scripts/check-places-ui.cjs`.
- This report and the supersession note in `backend/docs/PLACES_PHOTO_INTEGRATION.md`.

No dependency, new native permission, identity/matching change, product image change, schema change or separate infrastructure. Existing uncommitted work and SHARE_TO_MYSTASH_V2.md remain preserved.
