# Discover Anywhere — Phase 1: Share Capture

Status: implemented. Architecture reference: [`mystash-user-ingestion-architecture-audit.md`](./mystash-user-ingestion-architecture-audit.md).

Phase 1 is the **capture/acceptance layer only**:

```
Instagram / YouTube / Browser → Android Sharesheet → Mystash
  → mystash://import?text=… → POST /imports (authenticated) → "Got it" acknowledgement
```

Nothing is fetched, extracted, resolved, queued, or added to the Bag. A user import is a
user-scoped submission record: *this user shared this URL*.

---

## 1. Android share target

`android/` is a gitignored prebuild output, so the share target lives in the Expo config
plugin `plugins/withAndroidShareIntent.js` (registered in `app.json` → `expo.plugins`).
Run `npx expo prebuild --platform android` (or `npm run android`) to apply it.

The plugin does two things:

1. **Manifest** — adds an exported `.ShareIntentActivity` with an
   `ACTION_SEND` + `category.DEFAULT` + `text/plain` intent filter, which is what puts
   Mystash in the Sharesheet. The mod is idempotent across prebuilds.
2. **Native source** — writes `ShareIntentActivity.kt`, a translucent no-history activity
   that reads `Intent.EXTRA_TEXT` (falling back to `EXTRA_SUBJECT`), trims it, caps it at
   4000 characters, and re-emits it as a `mystash://import?text=…` `ACTION_VIEW` intent
   aimed at `MainActivity`, then finishes.

`MainActivity` is `launchMode="singleTask"` and already handles the `mystash://` scheme, so
the payload arrives through the **existing expo-router deep-link path** — the same route
`mystash://auth/callback` uses. No second navigation system, and no validation, networking,
or product logic in native code.

Why a bridging activity at all: `expo-linking` only surfaces intents that carry a data URI.
`ACTION_SEND` carries the payload in extras, so an unmodified Expo app cannot see a share.

## 2. Input normalization

Two small layers, both pure and unit-tested. The backend is authoritative; the client copy
exists so the screen can fail fast without a round trip.

| Layer | Module |
| --- | --- |
| Client | `src/ui/shareImport.ts` (`extractSharedLink`) |
| Backend | `backend/src/user-import/domain/sharedInput.ts` (`normalizeSharedInput`) |

Both: trim the payload, extract the first `http(s)` URL out of surrounding prose, strip
trailing punctuation, and reject non-web schemes. The backend additionally reuses
`validHttpUrl` (`shopping/urlValidation.ts`), `canonicalizeProductUrl`
(`pipeline/urlCanonicalization.ts`) and `parseSupportedVideoUrl` (`pipeline/sourceIdentity.ts`),
and records a platform hint.

Accepted:

- a raw URL — `https://www.instagram.com/reel/ABC/`
- text containing a URL — `Check this out:\nhttps://www.youtube.com/shorts/XYZ`
- surrounding whitespace / prose punctuation — `Loved this (https://shop.example.com/p/mug).`
- any public product / web page URL (shape only — support is not narrowed to video platforms)

Rejected (`400`, with user-facing copy only):

| Reason | Example |
| --- | --- |
| `EMPTY_INPUT` | empty or whitespace-only share |
| `NO_URL_FOUND` | `look at this reel` |
| `UNSUPPORTED_SCHEME` | `file:`, `ftp:`, `javascript:`, `mailto:`, `content:`, `intent:` |
| `MALFORMED_URL` | `https://:8080/x` |
| `CREDENTIALS_IN_URL` | `https://user:pass@host/x` |
| `PRIVATE_DESTINATION` | `localhost`, `127.0.0.1`, `10/8`, `172.16/12`, `192.168/16`, `169.254.169.254`, `[::1]`, `*.local`, `*.internal`, bare intranet hostnames, numeric shorthand like `127.1` |
| `INPUT_TOO_LONG` | payload over 4000 characters |

Host checks are literal only (`backend/src/user-import/domain/hostSafety.ts`) — no DNS
resolution, because Phase 1 never fetches. **A phase that fetches must re-validate after
DNS resolution.**

`normalizedUrl` is what dedupes: for YouTube/Instagram it is `parseSupportedVideoUrl`'s
canonical form (so `youtu.be/X?si=…` and `youtube.com/shorts/X` collapse together); for
anything else it is `canonicalizeProductUrl` (hash + UTM + tracking params stripped).

## 3. API

`POST /imports` — registered in `backend/src/index.ts` via
`registerUserImportRoutes`, handler in `backend/src/user-import/routes.ts`.

Auth: `Authorization: Bearer <supabase user JWT>`, same pattern as `/cart` and `/users/me`.

Request — send the bare URL as `url`, or the whole shared payload as `text`:

```json
{ "text": "Check this out: https://www.instagram.com/reel/ABC/" }
```

Response `201 Created` (new) / `200 OK` (already submitted):

```json
{ "importId": "e3f1…", "status": "RECEIVED", "created": true }
```

Errors use the repo's `{ "error": "…" }` shape:

| Status | When |
| --- | --- |
| `401 Missing authorization` | no `Authorization` header |
| `401 Unauthorized` | header present, token invalid/expired |
| `400 url required` | no `url`/`text` string in the body |
| `400` (see rejection table) | malformed / unsupported / private URL |
| `400 userId must not be supplied by client` | body carries `userId`/`user_id` |
| `500 Could not accept the shared link` | persistence failure; details are logged, never returned |

**Idempotency** reuses the Cart convention rather than inventing a mechanism: a
`UNIQUE (user_id, dedupe_key)` constraint where `dedupe_key = sha256(normalized_url)`, plus
`201`-created / `200`-existing and a `23505` race re-read. Re-sharing the same link is not
an error and does not create a second row. Idempotency is per user.

The endpoint explicitly does **not** fetch the URL, run extraction or AI, resolve products,
write `catalog_products`, create `discovered_products`, touch the Bag, or call
`ShoppingResolver`.

## 4. Data model

`supabase/migrations/20260920120000_user_imports.sql` adds one additive table,
`public.user_imports`: `raw_input` (verbatim share), `source_url` (extracted),
`normalized_url`, `dedupe_key`, `platform`, `status`, plus timestamps and `schema_version`.
`status` is `CHECK (status IN ('RECEIVED'))` — Phase 1's only state.

RLS is on with owner-`SELECT` only; writes go through the service-role backend, matching the
other pipeline tables. Catalog remains Product SoT and Cart remains Bag-membership SoT;
`user_imports` owns submissions and nothing else.

## 5. Acknowledgement UX

`app/import.tsx` (registered on the existing root `Stack` in `app/_layout.tsx`) submits once
per payload and shows one of four states: sending, acknowledged
(**"Got it — Mystash received your link."**), signed out (sign-in prompt), or a rejection
message with retry.

It deliberately does **not** say "Saved" or "Added to Bag", and shows no product, Bag item,
verification status, confidence, AI state, or processing progress — a test asserts this.

## 6. Running the tests

Backend (from `backend/`): `npm test`, or just this domain:

```bash
./node_modules/.bin/tsx --test src/user-import/domain/sharedInput.test.ts \
  src/user-import/UserImportService.test.ts src/user-import/routes.test.ts
```

Client / plugin (from the repo root):

```bash
./backend/node_modules/.bin/tsx --test src/ui/shareImport.test.ts \
  plugins/withAndroidShareIntent.test.ts
```

`UserImportService.test.ts` asserts the Phase 1 guarantee directly: after accepting imports,
an in-memory Catalog and Cart are both still empty, and the domain's sources contain no
reference to Product Intelligence, AI, queues, `catalog_products`, `cart_items`, or `fetch`.

## 7. Phase 1 limitations

- **Android only.** iOS share extension is not implemented.
- **No processing.** `RECEIVED` is terminal; nothing consumes `user_imports` yet.
- **No content/source identity.** `content_sources` is Phase 2; `platform` is a hint only.
- **Shape validation only.** An accepted URL may still turn out to be unreachable or
  unsupported once a later phase fetches it.
- **No rate limiting or abuse controls** on `/imports` yet; required before arbitrary URL
  fetch is enabled.
- **No history surface.** There is no screen listing prior imports.
- Trailing-punctuation trimming can over-trim exotic URLs that legitimately end in `)` or `.`;
  `raw_input` always preserves the original so a later phase can recover.

## 8. What Phase 2 adds

Implemented. See [`mystash-user-ingestion-phase-2-content-source.md`](./mystash-user-ingestion-phase-2-content-source.md).

`content_sources` is the global identity; `user_imports.content_source_id` points at it;
`POST /imports` get-or-creates the source and enqueues `content-source-processing` on the
existing BullMQ stack. The HTTP contract is unchanged. There is still no product
extraction and no promotion into `catalog_products`.
