# Search FE Implementation Plan (Phase 6A)

**Status:** Phase 6A plan complete · **Phase 6B FE implemented** (OD-5A honest empty landing)  
**Architecture authority:** [`FE_DOMAIN_ARCHITECTURE_V1.md`](./FE_DOMAIN_ARCHITECTURE_V1.md) (FROZEN)  
**Backend authority:** [`../../backend/docs/SEARCH_DOMAIN_SPEC.md`](../../backend/docs/SEARCH_DOMAIN_SPEC.md), [`../../backend/docs/SEARCH_DOMAIN_IMPLEMENTATION_PLAN.md`](../../backend/docs/SEARCH_DOMAIN_IMPLEMENTATION_PLAN.md), [`../../backend/docs/SEARCH_TECHNOLOGY_SELECTION.md`](../../backend/docs/SEARCH_TECHNOLOGY_SELECTION.md), [`../../backend/docs/SEARCH_OPERATIONS.md`](../../backend/docs/SEARCH_OPERATIONS.md)  
**Related FE plans:** Product / Creator / Collection-Reel / Cart  
**Engagement:** Phase 5 / 5B complete — reuse; do not redesign  

**Scope of 6A:** Determine what Search already is, what FE must compose, and the smallest 6B work.  
**Out of 6A:** Implementation, migrations, Home Feed, Reel redesign, Cart, Engagement redesign, Search ranking redesign.

---

## 1. Existing Search audit

### 1.1 Verdict

**Search is not missing on the backend.** A full V1 Search domain exists under `backend/src/search/` with hybrid retrieval, ranking, blended APIs, indexing bridges, and tests.

**Search is missing on the FE as a canonical discovery surface.** `app/(tabs)/search.tsx` is still a **legacy placeholder**: client-side filter over Supabase `videos` via `fetchVideos()`, non-interactive video rows, no `/search` client, no canonical cards, no navigation.

**Product-intelligence** (`backend/src/product-intelligence/search/*` — Tavily/Serper/PDP) is a **separate ingest/enrichment pipeline**. It is **not** user-facing Discover Search and must not be wired into the Search tab.

### 1.2 Spec / docs vs code

| Doc | Claim | Reality |
|-----|--------|---------|
| `SEARCH_DOMAIN_SPEC.md` | Collections + Creators + Catalog Products; blended; hybrid; deterministic rank; Video not a result entity | **Aligned with code** |
| `SEARCH_TECHNOLOGY_SELECTION.md` | OpenSearch frozen; embeddings in OpenSearch; Mystash ranks | **Aligned** (`OpenSearchIndex` + `InMemorySearchIndex`) |
| `SEARCH_DOMAIN_IMPLEMENTATION_PLAN.md` | Header still says “no code / no APIs” | **Stale** — V1 core is implemented |
| `FE_DOMAIN_ARCHITECTURE_V1.md` §12 | Public Search composing tiles/cards + Search APIs | Backend ready; FE not |
| `FE_DOMAIN` §13 CollectionTile → Focused Reel | Historical navigation preference | **Superseded for Search 6B by this plan** → `/collection/[collectionId]` (see §7) |

### 1.3 Current FE Search screen (exact)

**File:** `app/(tabs)/search.tsx` (tab route kept)

| Concern | Today |
|---------|--------|
| Data | `fetchVideos()` → Supabase `videos` (+ `video_products`) |
| Query | Local `TextInput`; filter on every keystroke; **no debounce** |
| Match | `product_name`, `creator_name`, product name/provider |
| Empty query | Lists all loaded videos (“Published videos”) |
| Results | Non-pressable thumbnail + name + “by creator” + stash score |
| Cards | None of `CollectionTile` / `CreatorCard` / `ProductCard` |
| HTTP Search | **None** |
| Autocomplete / telemetry | **None** |
| Navigation | **None** |
| Error / empty copy | Silent empty on fetch failure |

`SearchProductCard` exists as a thin alias of `ProductCard` and is unused by Search.

---

## 2. Backend capabilities

### 2.1 Searchable entities

| Entity | Indexed? | Result lane? | Notes |
|--------|----------|--------------|-------|
| **Collection** | Yes | Primary | `collectionId`; eligibility via `searchEligible` |
| **Creator** | Yes | Yes | `userId` + `username`; ACTIVE creators |
| **Catalog Product** | Yes | Yes | `catalogProductId`; ACTIVE catalog only |
| **Video** | **No** | **No** | Correct — do not reintroduce |
| Brand / Category | Internal only | **Not** result types | Filters/facets only |

### 2.2 HTTP APIs (`backend/src/search/routes.ts`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/search` | Optional Bearer | Blended search |
| `GET` | `/search/autocomplete` | Optional | Suggestions (+ recent if user) |
| `POST` | `/search/telemetry/click` | Optional | Search CTR (Search-owned) |
| `GET` | `/search/candidates` | None | Recs handoff (not FE V1) |
| `POST` | `/search/index/{collection\|creator\|product}` | **None** | Bootstrap/dev index |
| `DELETE` | `/search/index/:entityType/:id` | **None** | Index delete |

Registered via `registerSearchRoutes(app)` in `backend/src/index.ts`.

### 2.3 `GET /search` contract

**Query params:** `q` (required), `presentation=unified|typed`, `limit`, `cursor`, filters `creator_id`, `brand`, `category`, `verified`, `recent`, `popular`, `lexical_only=1`.

**Response (`BlendedSearchResponse`):**

```text
query, intent, retrievalMode, presentation,
results: SearchResultCard[],
lanes?: { collections, creators, products },
nextCursor, zeroResult, latencyMs, degraded?
```

**`SearchResultCard` identity:**

| `entityType` | `id` means | Extra fields for FE |
|--------------|------------|---------------------|
| `collection` | `collectionId` | `slug`, `primaryMediaRef` / `imageRef`, `creator.{creatorId,username,displayName,avatarRef}`, `productTagCount` |
| `creator` | `userId` | `username`, `title`/`subtitle`, `imageRef` |
| `product` | `catalogProductId` | `title`, `subtitle`, `imageRef`, `verificationStatus` (**no** separate `catalogProductId` field name) |

Limits: default **20**, max **50**. Cursor = base64url offset `{ o }`.

### 2.4 Ranking / relevance (existing — do not redesign)

```text
prepareQuery → detectQueryIntent → lexical + vector
  → RRF hybrid fuse → rankCandidates → diversify (≤3 collections/creator)
  → blendResults (unified score order | typed lane quotas)
```

Intent is rule-based (`EXACT_PRODUCT`, `CREATOR`, `DISCOVERY`, …). No LLM / ML LTR.

### 2.5 Indexing / ops

- Event-driven bridges: Collection / User / Catalog / Engagement nearline (`schedule.ts`)
- Backends: OpenSearch (prod / when `OPENSEARCH_URL`) or InMemory (dev fallback)
- Ops: `docker-compose.search.yml`, alias generations (`SEARCH_OPERATIONS.md`)

### 2.6 Autocomplete

`GET /search/autocomplete` returns `{ query, suggestions[{ kind, text, id?, entityType? }] }` with kinds including entity / recent / trending (trending from **in-memory** Search telemetry — not a durable discovery feed).

### 2.7 Tests

`SearchService.test.ts` covers blended/typed, lexical-only, eligibility, pagination cursors, telemetry, nearline mirrors, etc. (~unit suite includes Search). OpenSearch integration optional via env.

---

## 3. Backend gaps (for 6B awareness — implement only if blocking)

| Gap | Severity for FE V1 | Smallest fix (later) | Migration? |
|-----|--------------------|----------------------|------------|
| Empty `q` → `400` (`q required`) | **Blocks chronological landing via Search API** | Product decision OD-5; or optional empty-q popular/recent mode | No |
| Product card omits price / brand / `catalogProductId` alias / slug | Medium — FE can map `id` → catalog id; hydrate via `fetchCatalogProductsByIds` | Optional card enrichment | No |
| Creator card omits `followersCount` / `collectionCount` | Low — CreatorCard can show `0` or omit stats from Search-mapped VM | Enrich `toResultCard` | No |
| Collection card omits engagement counters | Low — `CollectionTile` can default counters to `0` | Optional | No |
| Unauthenticated `/search/index/*` | Ops/security — **not FE V1** | Auth / admin gate | No |
| OpenSearch filter parity vs InMemory | Low for unfiltered V1 Search | Align filters | No |
| Telemetry store in-memory only | Acceptable for V1 click posts | Durable store later | Maybe later |
| Personalization / follow-boost | Out of V1 FE | — | — |
| Plan doc stale (“no code”) | Docs only | Update plan status | No |

**None of the above block starting FE 6B** if landing is an honest empty/prompt state (recommended default for OD-5).

---

## 4. Canonical Search result contract

### 4.1 Principle

Search returns **discovery hits**. FE maps each hit into **canonical presentation models** (or thin wrappers that embed them). Search must **not** invent parallel `SearchProduct` / `SearchCreator` / `SearchCollection` SoTs (`FE_DOMAIN` §4.5).

### 4.2 Identity → navigation

| Hit | Canonical identity | Navigate |
|-----|--------------------|----------|
| Product | `catalogProductId = card.id` when `entityType === 'product'` | ProductDetailsSheet (existing flow) |
| Creator | `userId = card.id`; route key = `card.username` | `/creator/[username]` |
| Collection | `collectionId = card.id` | `/collection/[collectionId]` |

**Do not** use Video id. **Do not** navigate to legacy `/product-list`.

### 4.3 Mapping strategy (6B)

| Hit | Target VM | Map from card | Hydration |
|-----|-----------|---------------|-----------|
| Collection | `CollectionViewModel` | `id→collectionId`, title, image, creator snapshot, `productTagCount→productCount`; counters default `0` | Optional later |
| Creator | `CreatorViewModel` (partial) | `id→userId`, `username`, displayName, avatar; stats default `0` / status placeholders as needed for card | Optional `fetchPublicCreatorByUsername` only if card too thin |
| Product | `CatalogProductViewModel` | Prefer **batch hydrate** via existing `fetchCatalogProductsByIds` + `catalogRowToViewModel` using `card.id` | **Recommended** so ProductCard/Buy/ATC work correctly |

### 4.4 Response field gaps preventing navigation?

| Need | Available? |
|------|------------|
| Collection id | Yes (`id`) |
| Creator username | Yes (`username`) |
| Catalog product id | Yes (`id` as catalogProductId) |
| Product price/merchant for Buy | **Not on card** → hydrate from Catalog |
| Creator username missing | Skip CreatorCard press / hide hit (should be rare; indexed creators require username) |

---

## 5. Recommended V1 Search UX

### 5.1 Entry / chrome

- Keep tab: `/(tabs)/search`
- Replace implementation of `app/(tabs)/search.tsx` only (same route)
- Public surface — **no login gate** for query/results/open
- Auth only for Save / Follow / Add to Cart (if exposed)

### 5.2 Search input

- Single search field (primary chrome)
- Debounced query (≥250–300ms) before `GET /search`
- Clear control; submit on keyboard search
- Optional: call `GET /search/autocomplete` while typing (short debounce); selecting suggestion fills query and/or navigates if `id`+`entityType` present

### 5.3 States

| State | Behavior |
|-------|----------|
| **Landing (empty query)** | Search bar + honest empty/prompt (“Search collections, creators, and products”). **No fake Trending.** See OD-5 for optional recent Collections |
| **Loading** | Spinner / lightweight placeholder list; keep prior results until replace optional |
| **Active results** | Debounced `GET /search` with `presentation=typed` (see §6) |
| **No results** | Clear zero-result copy; do not invent related fake content (backend may return popular collections only when degraded — FE should not invent extra) |
| **Error** | Explicit retry; do not silently clear without message |
| **Pagination** | When `nextCursor` set → load more (footer spinner); append; stop when null |

### 5.4 Keyboard / input

- Auto-focus optional on tab focus (product preference; not blocking)
- Dismiss keyboard on scroll / result press
- Do not search on every key without debounce

### 5.5 What not to ship in V1

- Trending / recs carousels without durable backend feed
- Video-based rows
- New product/creator/collection card implementations
- Auth wall on Search
- Tabs that re-query three separate backends (use one blended API)

---

## 6. Result composition

### 6.1 Recommendation

**Grouped sections fed by `presentation=typed` + `lanes`.**

Rationale:

- Backend already returns `lanes.collections | creators | products` with Collection-primary quotas
- Clearer than a single mixed list for first V1
- Matches architecture “Collections (primary), Creators, Products”
- Avoids inventing a second query model
- Prefer **sections**, not separate top-level tabs (tabs would hide Collection primacy and add chrome)

**Unified** (`presentation=unified`) remains available for later A/B; not default for 6B.

### 6.2 Per-type presentation

| Type | Display | Component | On tap | Engagement / telemetry |
|------|---------|-----------|--------|------------------------|
| Collection | Thumb, title, creator, product count | **`CollectionTile`** | `/collection/[collectionId]` | Search: `POST /search/telemetry/click` with `clicked_entity_type=collection`. Destination page already emits Collection **view** |
| Creator | Avatar, name, `@username`, optional stats | **`CreatorCard`** | `/creator/[username]` | Search click telemetry. Follow only if Follow UI added (existing follow APIs); no invent |
| Product | Image, title, verification, price when hydrated | **`ProductCard`** `variant="standard"` (prefer over `SearchProductCard` alias) | Open **`ProductDetailsSheet`**; Buy/ATC via existing orchestration | Search click telemetry. Local `trackProductEvent` may fire from ProductCard (already). **Not** Engagement merchant_click until Buy/redirect |

### 6.3 Ordering

- Within sections: backend lane order (already ranked)
- Section order on screen: **Collections → Creators → Products**
- Do not client-re-rank

---

## 7. Navigation (frozen for 6B)

```text
Search → Creator    → /creator/[username]
Search → Collection → /collection/[collectionId]
Search → Product    → ProductDetailsSheet (canonical Product flow)
                     → Buy / Add to Cart via existing handlers
```

| Forbidden | Reason |
|-----------|--------|
| `/product-list/[id]` | Legacy redirect surface |
| Treating `video.id` as collection | Architectural violation |
| Search-owned entity detail pages | Compose existing routes/sheets |

**Note vs older FE_DOMAIN §13:** Architecture once preferred CollectionTile → Focused Reel. **Creator Profile today** and **this Phase 6A brief** use Collection page. **6B Search Collection hits → `/collection/[collectionId]`.** Focused Reel remains available from Collection/other surfaces; not required as Search’s primary target.

---

## 8. Engagement integration

### 8.1 Separation of concerns (frozen)

| Concern | Owner | API |
|---------|-------|-----|
| Query / autocomplete / **search result click CTR** | **Search** | `GET /search`, `GET /search/autocomplete`, `POST /search/telemetry/click` |
| Collection view / save / share, creator follow / share, merchant redirect | **Engagement** | Existing Phase 5 APIs |

Do **not** create Search-specific Engagement event types. Do **not** record Engagement facts for “search result rendered.”

### 8.2 Recommended emit matrix

| User action | Emit |
|-------------|------|
| Run search | Backend already records query telemetry inside `SearchService.search` |
| Tap Collection / Creator / Product hit | `POST /search/telemetry/click` `{ query, clicked_id, clicked_entity_type, anonymous_id? }` |
| Land on Collection page | Existing `recordCollectionView` (surface e.g. `collection_page`) — already on Collection route |
| Save / Follow from destination | Existing Engagement save/follow |
| Buy from Product sheet | Existing shopping redirect → `merchant_click` (server) |

### 8.3 Gaps (document only — do not invent)

| Desired signal | In Engagement domain? | Action |
|----------------|----------------------|--------|
| Search result impression | Spec telemetry has `impression` type; **no HTTP route**; not Engagement | Optional later Search route — **out of 6B V1** |
| Search abandonment | Same | Out of V1 |
| Product click (pre-redirect) as Engagement `product_click` | Defined in types; **not** wired from FE Search today | Document gap; Buy path uses `merchant_click` via redirect |

---

## 9. Pagination / loading / error behavior

| Topic | Spec |
|-------|------|
| Page size | Start `limit=20` (within backend max 50) |
| Next page | Pass `nextCursor`; append to the matching section lists |
| Dedup | Trust backend cursor; client-guard by `entityType+id` if needed |
| Loading more | Footer indicator; disable duplicate in-flight |
| Pull-to-refresh | Re-run current query from offset 0 |
| Offline / 5xx | Error state + Retry |
| `degraded[]` | Optional subtle note; do not block UI |
| Empty `q` | Do not call `/search` (unless OD-5 chooses a dedicated landing API) |

---

## 10. Legacy components / routes to replace (6B) — do not delete in 6A

| Asset | Action in 6B |
|-------|----------------|
| `app/(tabs)/search.tsx` implementation | **Replace** (keep route) |
| `fetchVideos` / `Video` as Search SoT | **Stop using** on Search |
| Ad-hoc video result rows | **Remove** with rebuild |
| `SearchProductCard` | Prefer `ProductCard`; leave alias until later cleanup (**DEPRECATE LATER**) |
| Mock `mockVideos` | Not used by Search runtime today; keep mocks file; do not use for Search |
| `/product-list` from Search | **Never wire** |
| product-intelligence search providers | **Not FE Search** |

No deletes in 6A.

---

## 11. Exact files expected to change in 6B

### FE (primary)

| File | Change |
|------|--------|
| `app/(tabs)/search.tsx` | Canonical Search UX |
| `src/services/searchApi.ts` | **New** — `/search`, autocomplete, telemetry client |
| `src/mappers/searchMapper.ts` (or similar) | **New** — DTO → Collection/Creator/Product VMs |
| Possibly small helpers under `src/services/` | Debounce, anonymous id reuse for telemetry |

### FE (reuse — wire only, avoid redesign)

| File | Role |
|------|------|
| `components/collection/CollectionTile.tsx` | Collection hits |
| `components/creator/CreatorCard.tsx` | Creator hits |
| `components/commerce/ProductCard.tsx` | Product hits |
| `components/commerce/ProductDetailsSheet.tsx` | Product open |
| `src/services/productActionOrchestration.ts` | Buy / ATC |
| `src/services/supabase.ts` `fetchCatalogProductsByIds` | Product hydrate |
| `src/services/catalogProductMapper.ts` | Row → VM |
| `src/services/anonymousId.ts` | Optional Search click anon id |
| Theme / shared chrome | Match Profile/Creator visual language lightly |

### Backend (only if OD-5 or card enrichment chosen)

| File | Only if |
|------|---------|
| `backend/src/search/routes.ts` / `SearchService.ts` | Empty-q landing or card field enrichment |
| `backend/src/search/domain/ranking.ts` `toResultCard` | Enrich creator/product fields |

---

## 12. Files explicitly protected (do not change in 6B unless tiny unblock)

- Home Feed / `app/(tabs)/index.tsx` Reel architecture
- `components/ReelItem.tsx` / Home view analytics (already done)
- Cart domain / `app/cart.tsx` (only reuse ATC handler)
- Engagement domain architecture / routes (only call existing clients)
- Collection publish / ingest / product-intelligence pipeline
- Shopping destination resolver
- Search ranking redesign / OpenSearch schema redesign
- Discovery / trending / recommendations engines
- Saved Collections (if not already present — out of Search scope)
- No unrelated refactors

---

## 13. Backend implementation order (6B)

1. **Confirm runtime index** (OpenSearch or populated InMemory) in the env FE will hit — ops, not code.
2. **Smoke** `GET /search?q=…&presentation=typed` and autocomplete against that env.
3. **Only if OD-5 requires it:** smallest empty-q / recent landing endpoint or documented Collection list — else skip.
4. **Optional non-blocking:** enrich `toResultCard` with followersCount / priceAmount for richer cards.
5. **Do not** block FE on telemetry durability or index-route auth hardening.

---

## 14. FE implementation order (6B)

1. `searchApi.ts` + types for `BlendedSearchResponse` / cards / autocomplete / click.
2. Mappers: Search card → `CollectionViewModel` / partial `CreatorViewModel`; product ids → hydrate → `CatalogProductViewModel`.
3. Rebuild `search.tsx` chrome: input, debounce, landing, loading, error, zero-result.
4. Render typed sections with `CollectionTile` / `CreatorCard` / `ProductCard`.
5. Wire navigation + ProductDetailsSheet + Buy/ATC handlers.
6. Wire `POST /search/telemetry/click` on result press (before or with navigation).
7. Cursor pagination / load more.
8. Optional autocomplete overlay.
9. Lint / typecheck / manual QA matrix (§15).

---

## 15. Tests / QA plan

### Automated (6B)

| Layer | Cases |
|-------|--------|
| Mapper unit | entityType→id mapping; never use video id; missing username guard |
| searchApi | Query string building; cursor; click body shape (mock fetch) |
| Screen (light) | Empty query does not call `/search`; debounce; section render with fixtures |

Backend Search tests already exist — rerun `npm test` / build; no Search redesign tests required unless backend gaps are implemented.

### Manual QA

| # | Scenario | Expect |
|---|----------|--------|
| 1 | Type Collection-like query | Collections section populated; tap → `/collection/[collectionId]` |
| 2 | Type `@` / creator handle | Creators section; tap → `/creator/[username]` |
| 3 | Type product/brand | Products; tap → sheet; Buy opens redirect |
| 4 | ATC logged out | Existing auth intent (not Search-owned) |
| 5 | Empty query | Honest landing; no fake trending |
| 6 | Zero results | Clear empty state |
| 7 | Pagination | Append; no duplicate ids |
| 8 | Network error | Retry works |
| 9 | Click telemetry | Network shows `/search/telemetry/click` |
| 10 | Collection open | Existing Engagement view still fires on Collection page |
| 11 | No `/product-list` | Confirmed |
| 12 | Logged-out Search | Fully usable for browse |

---

## 16. Open product decisions

| ID | Decision | Options | 6B default if unresolved |
|----|----------|---------|---------------------------|
| **OD-5** | Landing content | (A) Honest empty/prompt only · (B) Chronological recent Collections (needs API: empty-q Search or Collection global list — **gap**) | **(A)** — proceed immediately |
| **OD-6** | Autocomplete in V1 | (A) Include · (B) Defer | **(A)** lightweight if time; else defer without blocking |
| **OD-7** | Show Follow/Save on Search rows | (A) Destination only · (B) Inline on cards | **(A)** destination-only (matches current Creator/Collection patterns) |
| **OD-8** | Product hydrate vs thin card | (A) Batch Catalog hydrate · (B) Thin VM from card only | **(A)** hydrate for Buy/ATC correctness |

**None of OD-5–8 block starting 6B** if defaults above are accepted.

---

## 17. Consistency audit vs domain architecture

| Principle | Status |
|-----------|--------|
| Search does not own Product/Creator/Collection SoT | Aligned (plan) |
| Compose CollectionTile / CreatorCard / ProductCard | Aligned |
| Public Search; auth only for Save/ATC/Follow | Aligned |
| No fake trending | Aligned (OD-5A) |
| Search telemetry ≠ Engagement | Aligned |
| Video not a Search entity | Aligned (backend + plan) |
| Collection navigation from Search | **Frozen here** to `/collection/[collectionId]` (overrides older Reel-first Search note in FE_DOMAIN §13) |
| No duplicate card architectures | Aligned — deprecate `SearchProductCard` usage |
| Backend Search already Collection-first blended | Aligned — FE consumes typed lanes |
| Home / Reel / Cart / Engagement protected | Aligned |

---

## 18. Go / no-go for Phase 6B

### Can Search proceed to 6B immediately?

**Yes — proceed to 6B FE implementation.**

Blocking product/backend decisions: **None**, given OD-5 default = honest empty landing.

### Prerequisites (ops, not code)

- Target backend reachable at `EXPO_PUBLIC_MYSTASH_INGEST_URL`
- Search index populated (event bridges and/or bootstrap) so queries return real hits
- Confirm OpenSearch vs InMemory for that environment (`SEARCH_OPERATIONS.md`)

### Explicit non-goals carried into 6B

No Search ranking redesign, no Engagement redesign, no Home Feed changes, no Reel redesign, no Cart redesign, no migrations unless a future OD-5B landing API truly requires schema (unlikely), no inventing Search Engagement events, no commit/push unless separately requested.

---

*End of Phase 6A plan.*
