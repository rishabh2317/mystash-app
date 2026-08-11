# Mystash Frontend Architecture Audit

**Scope:** Existing frontend only. Investigation / documentation. No Search FE implementation, no API changes, no component modifications.

**Repo layout note:** There is no separate `frontend/` application package. The Expo React Native app lives at the **repository root** (`app/`, `components/`, `src/`, `contexts/`, `hooks/`, `constants/`). This document is stored under `frontend/docs/` as requested for Search FE planning artifacts.

**Audit date:** 2026-08-11

---

## 1. Frontend stack

| Concern | Actual implementation |
| --- | --- |
| Framework | **Expo** (`expo` ~54.0.33) + **React Native** 0.81.5 |
| Entry | `expo-router/entry` (`package.json` `main`) |
| Language | **TypeScript** ~5.9.2 (`strict: true`) |
| React | 19.1.0 |
| Routing / navigation | **Expo Router** ~6.0.23 (file-based) on **React Navigation** 7.x (`@react-navigation/native`, bottom-tabs) |
| State management | **No Redux / Zustand / React Query.** Screen-local `useState` / `useRef`; React Context for auth, theme, cart; module-level Maps for curation drafts and feed-reload pub/sub |
| API / data fetching | Dual: (1) **Supabase JS client** for auth + feed `videos` / `video_products` / `catalog_products`; (2) raw **`fetch`** to Node backend (`EXPO_PUBLIC_MYSTASH_INGEST_URL`) for ingest, publish, shopping redirect |
| Auth / user context | `contexts/AuthContext.tsx` — Supabase Auth (email/password + Google OAuth PKCE via `expo-web-browser`) |
| Styling / design system | Primary: **React Native `StyleSheet`**. Theme colors in `constants/theme.ts` + custom **Titanium / Nebula** modes in `contexts/ThemeContext.tsx`. **NativeWind** is a dependency + `tailwind.config.js` / `global.css` exist, but **no `className` usage** and babel is plain `expo` (NativeWind not wired) |
| Component architecture | Flat `components/` + `components/commerce/` (+ wrappers). Screens in `app/`. Shared services/types under `src/` |
| Testing framework | **None on the frontend.** No Jest/Vitest/Detox/RNTL in root `package.json`. All `*.test.ts` found are under `backend/` |
| Analytics / telemetry | Lightweight console logging: `src/logging/curationLog.ts` + `src/logging/productAnalytics.ts`. No Segment/Amplitude/Firebase Analytics. No Engagement-domain client |

Path alias: `@/*` → repo root (`tsconfig.json`).

---

## 2. Navigation architecture

### Root stack (`app/_layout.tsx`)

- Providers: `ThemeModeProvider` → `AuthProvider` → React Navigation `ThemeProvider`
- Stack screens:
  - `(tabs)` — main tabs (`headerShown: false`)
  - `auth/callback` — OAuth callback
  - `modal` — modal presentation
  - `product-list/[id]` — product list for a video/reel
  - `cart` — shopping bag (stub-ish)
- `unstable_settings.anchor = '(tabs)'`

### Bottom tabs (`app/(tabs)/_layout.tsx`)

Defined with Expo Router `<Tabs>`:

| Tab file | Route name | Title | Icon (`IconSymbol`) |
| --- | --- | --- | --- |
| `index.tsx` | `index` | Home | `house.fill` |
| `search.tsx` | `search` | Search | `magnifyingglass` |
| `create/` | `create` | Create | `plus.circle.fill` |
| `profile.tsx` | `profile` | Profile | `person.crop.circle.fill` |

- `headerShown: false` for tabs
- Tab press uses `HapticTab` (iOS light haptic)

### Nested navigation

- **Create** is a nested stack: `app/(tabs)/create/_layout.tsx` → `index` | `manual` | `review`
- Home / Search / Profile are single screens under tabs

### Route naming conventions

- File-based Expo Router paths: `/(tabs)`, `/(tabs)/search`, `/(tabs)/create`, `/(tabs)/create/review?ingestId=…`, `/product-list/[id]`, `/cart`, `/auth/callback`
- Typed routes experiment enabled in `app.json` (`experiments.typedRoutes: true`)

### Destinations: Collection / Creator / Product

| Destination | How FE navigates today |
| --- | --- |
| **Collection** | **No Collection route or domain UI.** Published content is modeled as **`Video`** (legacy `videos` table). Backend publish dual-writes `collection_id` ≈ `videos.id`, but the app never navigates by collection slug/id |
| **Creator** | **No Creator profile route.** Creator appears as text (`creator_name`, `curator_id`) on reels / Search list rows. Profile tab is the **signed-in user**, not public creator profiles |
| **Product** | From Home reel: `BottomDock` → `router.push(\`/product-list/${video.id}\`)`. Shopping: `openProductShopping` → external browser via backend `/products/:id/redirect`. Create Review uses `ProductDetailsSheet` modal (not a stack route) |

### Search destination registration

- Registered as tab screen `name="search"` → file `app/(tabs)/search.tsx`
- Icon mapped in `components/ui/icon-symbol.tsx` (`magnifyingglass` → Material `search`)

---

## 3. Existing Search implementation

**Status: placeholder / client-side filter over the Home feed dataset. Not wired to Search domain APIs.**

| Element | Exists? | Detail |
| --- | --- | --- |
| Search screen | Yes | `app/(tabs)/search.tsx` |
| Search tab icon | Yes | Magnifying glass in tab bar |
| Search bar / input | Yes | RN `TextInput`, placeholder “Search catalog products or creators…” |
| Autocomplete | **No** | No debounce, suggestions, or `/search/autocomplete` client |
| Search API client | **No** | Uses `fetchVideos()` from Supabase, then **local** `Array.filter` |
| Search state | Local only | `searchQuery`, `allVideos`, `filteredVideos`, `loading` via `useState`; reload on focus (`useFocusEffect`) |
| Result components | Ad-hoc inline | Thumbnail + product name + “by creator” + stash score — **not** shared Collection/Product cards |
| Search-related types | Indirect | Reuses `Video` / `Product` from `src/mocks/videos.ts` |
| Search telemetry | **No** | No click/query events; no `/search/telemetry/click` |
| Loading | Yes | `ActivityIndicator` |
| Error / empty | Weak | Errors clear lists silently; empty results just show zero rows (no dedicated empty UI) |
| Navigation from results | **No** | Result rows are **not pressable** — cannot open reel, creator, or product |

### Pre-built but unused Search commerce wrapper

- `components/commerce/wrappers/SearchProductCard.tsx` — thin alias of `ProductCard` for `CatalogProductViewModel`
- Exported from `components/commerce/index.ts`
- **Not imported by any screen** (including `search.tsx`)

---

## 4. Collection architecture

**Frontend does not implement the Collection domain.** UX vocabulary is **video / reel**.

### What exists (Collection-analogue)

| Concern | Implementation |
| --- | --- |
| “Collection” card / tile | **None** as Collection. Feed uses full-screen `ReelItem`. Search uses a simple row layout |
| Video / media presentation | `ReelItem` → `YouTubeReelItem` / `InstagramReelItem` (WebView embeds + thumbnail) |
| Collection detail screen | **None.** Closest: Home full-screen reel + `/product-list/[id]` |
| Feed / reels | `app/(tabs)/index.tsx` — vertical paging `FlatList` of `ReelItem` |
| Reusable Collection components | **N/A** — reuse candidates are reel/media pieces (below) |
| Media handling | External YouTube/Instagram URLs; no in-app upload/hosting UI beyond Create ingest URL |
| Creator attribution | Text in `BottomDock` (`curator_id` \|\| `creator_name`) |
| Product count / presentation | Horizontal product chips in `BottomDock`; “View More” → product list |
| Navigation into a Collection | Navigate by **video id** only (`/product-list/:id`); no `/collection/:slug` |

### Backend alignment (read-only context for FE)

- Publish dual-writes Collection + legacy `videos` (`backend/src/publish.ts`). Home/Search FE still read **`videos`**.

### Potentially reusable for Search (Collection-shaped results)

- `ReelItem`, `YouTubeReelItem`, `InstagramReelItem` — if Search opens a reel experience
- `BottomDock` — product strip + creator metadata chrome
- `Header` — branded reel chrome
- Thumbnail row pattern in Search screen (replace/upgrade, not reuse as-is)

---

## 5. Creator architecture

| Concern | Exists? | Detail |
| --- | --- | --- |
| Creator cards | **No** dedicated component | |
| Creator profile (public) | **No** | |
| Avatars | Minimal | Profile tab may show user avatar from auth metadata; feed does not show creator avatars as a shared component |
| Usernames | Text fields | `creator_name`, `curator_id` on `Video`; Profile uses `user_metadata.username` |
| Creator metadata | Feed-only strings + stash score | |
| Navigation | **No** `router.push` to creator | |

**Reusable today:** none purpose-built. Profile screen patterns (row cards, theme toggle) are for **account settings**, not discovery.

---

## 6. Product architecture

### Catalog-oriented commerce UI (Create / Review path)

| Component | Role |
| --- | --- |
| `ProductCard` | Canonical catalog product row (`CatalogProductViewModel`) + view analytics |
| `ProductHeroImage` | Image with placeholder fallback |
| `VerificationBadge` | VERIFIED / UNVERIFIED / UNRESOLVED |
| `ProductDetailsSheet` | Modal bottom-sheet (~90% height): gallery, specs, merchant, “View Product” → shopping redirect |
| `MerchantSection`, `SpecificationGrid` | Detail sheet sections |
| `ReviewProductCard` | ProductCard + Include switch (Create review) |
| `PublishedVideoProductCard` | Alias of ProductCard — **unused by screens** |
| `SearchProductCard` | Alias of ProductCard — **unused by screens** |
| `catalogProductMapper.ts` | Maps DB/draft rows → `CatalogProductViewModel` |
| `src/types/catalogProduct.ts` | FE catalog view-model types |

### Feed / product-list path (legacy `Product` type)

| Piece | Role |
| --- | --- |
| `src/mocks/videos.ts` `Product` | `{ id, name, price, image, provider?, catalog_product_id? }` |
| `BottomDock` `ProductCardFrame` | Small dock chip (image + price) — **different** from commerce `ProductCard` |
| `app/product-list/[id].tsx` | Local inline `ProductCard` (Buy Now / Add to Bag) — **not** commerce module |
| `openProductShopping` | Backend redirect only |

### Product navigation

- Review: open `ProductDetailsSheet`
- Feed dock: `/product-list/${video.id}`
- Buy: `EXPO_PUBLIC_MYSTASH_INGEST_URL/products/:catalogProductId/redirect?...`

### Reusable for Search product hits

**Prefer:** `components/commerce/ProductCard` (+ optional `SearchProductCard` wrapper) and `ProductDetailsSheet`.  
**Avoid duplicating:** product-list’s inline card unless matching that specific Buy/Bag UX.

---

## 7. Feed / discovery architecture

| Surface | Component | API / service | Backend endpoint | State / model | Ranking ownership | Reuse for Search landing? |
| --- | --- | --- | --- | --- | --- | --- |
| Home feed (reels) | `app/(tabs)/index.tsx` + `ReelItem` | `fetchVideos()` → Supabase `videos` + `video_products` | Supabase REST (not Search) | `Video[]`, local loading/error/refresh | **Client order = `created_at` desc** from Supabase | Partial: media chrome only; **not** Search-ranked discovery |
| Feed reload after publish | `feedRefresh` pub/sub | `requestFeedReload` / `subscribeFeedReload` | N/A | In-memory listeners | N/A | Pattern for invalidation only |
| Trending | **None** | — | — | — | — | No |
| Popular | **None** (FE) | — | Backend Search supports `popular` filter; FE unused | — | Backend Search (future) | No FE surface |
| Recommended / Recs | **None** | — | `/search/candidates` exists server-side; FE unused | — | — | No |
| Collection discovery | **None** | — | Collection domain backend only | — | — | No |
| Product discovery | Create Review list only | Curation draft / ingest | `/ingest`, `/publish` | `CatalogProductViewModel` | Extraction / curator include toggles | Product **cards** reusable; not a discovery feed |
| Creator discovery | **None** | — | — | — | — | No |
| Search landing / empty-query | Current Search shows **all published videos** when query empty | Same as feed (`fetchVideos`) | Supabase | Same `Video` model | Chronological | **Not** suitable as Search landing without redesign — it’s a raw video dump, not curated discovery |

**Important:** Do **not** invent new trending/recs in FE from this audit. Nothing production-ready exists for Search landing beyond reusing visual primitives and optionally the chronological video list as a temporary stopgap (with clear caveats).

---

## 8. API architecture

### Patterns established

1. **Supabase client singleton** — `src/services/supabase.ts`  
   - Auth storage: AsyncStorage, PKCE  
   - Typed mapping functions (`mapRowToProduct`, `mapVideoRow`)  
   - Throws on feed load failure; soft-null on some mutations  

2. **Node backend `fetch` services** — `src/services/curation.ts`, `src/services/shoppingClick.ts`  
   - Base URL: `EXPO_PUBLIC_MYSTASH_INGEST_URL`  
   - Auth: `Authorization: Bearer ${session.access_token}` (+ optional `apikey: EXPO_PUBLIC_SUPABASE_ANON_KEY`)  
   - JSON parse with HTML/error normalization  
   - User-facing network error messages  

3. **No shared API client class** — no axios wrapper, no React Query, no generated OpenAPI client  

4. **Response typing** — hand-written TS types (`Video`, `CatalogProductViewModel`, curation types)  

5. **Error handling** — try/catch → `Alert` / empty state / `normalizeIngestError`  

6. **Caching** — none (beyond auth session persistence). Curation drafts: in-memory Map  

7. **Request cancellation** — focus-effect `cancelled` flags; **no AbortController** in FE services  

8. **Pagination / infinite scroll** — **absent**. Feed loads full `videos` select; Search filters in memory  

### Pattern Search FE should follow (inferred)

- New Search service module under `src/services/` (e.g. `search.ts`) calling Mystash backend with same Bearer token pattern as curation/shopping  
- Map HTTP DTOs → FE view-models (do not bind screens to raw OpenSearch docs)  
- Screen-local state (or a small dedicated store if pagination grows)  
- Optional: reuse `curationLog`-style structured console events until a real analytics SDK exists  

### Backend Search HTTP (exists; **FE does not call yet**)

Documented for planning context only — this audit does not add clients:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/search` | Hybrid/lexical query; filters; cursor pagination |
| GET | `/search/autocomplete` | Prefix suggestions |
| POST | `/search/telemetry/click` | Search-owned click telemetry |
| GET | `/search/candidates` | Recs candidates (one-way) |
| POST/DELETE | `/search/index/...` | Dev/bootstrap indexing |

---

## 9. State-management architecture

| Kind | Pattern | Examples |
| --- | --- | --- |
| Local UI state | `useState` / `useRef` in screens | Feed index, Search query, Review selections |
| Server state | Fetch on focus / mount; no cache layer | `fetchVideos`, ingest poll |
| Loading | Boolean flags + `ActivityIndicator` | Home, Search, Profile auth submit |
| Errors | String \| null or Alert | Home `loadError`; curation Alerts |
| Pagination | **None** | — |
| Caching | Auth session (AsyncStorage); curation draft Map | `curationDraftStore` |
| Navigation state | Expo Router | params `id`, `ingestId` |
| Global contexts | Auth, ThemeMode; Cart exists but **not mounted** in root layout | `CartProvider` unused in `app/_layout.tsx` |
| Cross-screen events | Tiny pub/sub | `feedRefresh.ts` |

**Search should reuse:** focus-aware fetch + cancelled flag; local loading/error; service-layer mapping. Introduce pagination state only when calling cursor-based `/search`.

---

## 10. Design system

### Themes

1. **Expo template light/dark** — `constants/theme.ts` (`Colors`, `Fonts`), `ThemedText` / `ThemedView`, `useColorScheme`  
2. **Product chrome Titanium / Nebula** — `ThemeContext` (`titanium` \| `nebula`) with Reanimated crossfade; used heavily on Home reel (`Header`, `BottomDock`, Profile)

### Visual vocabulary (observed)

- Accents: cyan `#00F2FF` / `#0EA5E9` / `#00AFC0`, purple `#A855F7` (Nebula), titanium grays  
- Cards: ~12–14 radius, light hairline borders, blur on Nebula (`expo-blur`)  
- Typography: system fonts via RN defaults / `Fonts` platform map; bold titles common  
- Inputs: ad-hoc `TextInput` styles (Search uses white box + `#ccc` border — **not** Titanium/Nebula aligned)  
- Buttons: `TouchableOpacity` / `Pressable`; Create uses header tint `#00AFC0`  
- Bottom sheets: `ProductDetailsSheet` via RN `Modal`  
- Loading: `ActivityIndicator`  
- Skeletons: **none**  
- Empty / error: copy + Retry on Home; weak elsewhere  
- Icons: `IconSymbol` (SF Symbol names → Material), `@expo/vector-icons` Ionicons  

**Guidance:** Match Titanium/Nebula + commerce card language for Search; do not invent a third visual system. Avoid relying on NativeWind until it is actually configured.

---

## 11. Media / video architecture

| Concern | Implementation |
| --- | --- |
| Video player | **WebView embeds**, not `expo-video` playback APIs in reel UI (plugin listed in `app.json`, not used by reel components reviewed) |
| YouTube | `YouTubeReelItem` + `youtubeWebViewEmbed.ts` — thumbnail → fade → HTML iframe player; mute bridge via injected JS |
| Instagram | `InstagramReelItem` + `instagramWebViewEmbed.ts` |
| Thumbnail | `expo-image`; YouTube maxres or stored `thumbnail` |
| External links | Source URLs on `Video.url` / `embed_url` |
| Aspect / layout | Full-screen reel: `Dimensions.get('window')` height/width; product-list embeds in constrained box |
| Tile layouts | Search: 72×96 thumb rows; Dock: 48×48 product thumbs |
| Hosting / upload | Create submits **source URL** to backend ingest — no FE video upload |

Search should reuse WebView reel components when opening media; use `expo-image` for result thumbnails.

---

## 12. Telemetry

| Layer | Detail |
| --- | --- |
| Abstraction | `curationLog(level, event, fields)` → console JSON with `svc: 'curation-client'` |
| Product events | `trackProductEvent` → curationLog with `surface: 'commerce'` |
| Event names | Dot-separated: `product.card.viewed`, `product.card.opened`, `product.details.viewed`, `product.view_product.clicked`, `ingest.submit.*`, etc. |
| Search telemetry | **None** on FE |
| Click / navigation tracking | Product cards/sheet only; no generic nav tracker |
| Engagement domain | **No FE client** to Engagement APIs |

Backend Search click telemetry (`POST /search/telemetry/click`) is separate from Engagement SoT — FE does not call it yet.

---

## 13. Responsive / mobile architecture

- **Portrait-first** (`app.json` `orientation: "portrait"`); iOS tablets allowed  
- Layouts use **window Dimensions** extensively (full-bleed reels, dock height 32% of screen)  
- Safe areas: used in `ProductDetailsSheet` (`useSafeAreaInsets`); Search/parallax less careful  
- Keyboard: no `KeyboardAvoidingView` on Search screen  
- Scrolling: Home = paging FlatList; Search = nested ScrollView inside ParallaxScrollView; Product list = ScrollView  
- Touch targets: dock volume ~32px; View More cell ~86px — generally finger-friendly  
- Web target exists (`react-native-web`) but primary UX is mobile reels  

---

## 14. Testing architecture

| Concern | Status |
| --- | --- |
| FE test runner | **Not configured** in root package |
| Component tests | **None** |
| Screen / integration tests | **None** |
| API mocking | **None** on FE (backend has its own tests) |
| Lint | `expo lint` / ESLint expo config |

Search FE will need a testing approach greenfield if required; there is no existing FE pattern to copy.

---

## 15. Reusable components (Search-relevant)

**Strong reuse candidates**

- `components/commerce/ProductCard` (+ unused `SearchProductCard` wrapper)
- `components/commerce/ProductDetailsSheet` (+ hero, badge, merchant, specs)
- `components/ReelItem` / `YouTubeReelItem` / `InstagramReelItem` (open collection/video hit)
- `components/BottomDock` / `Header` (if presenting a reel from Search)
- `components/themed-text`, `themed-view`, `ui/icon-symbol`
- `src/services/catalogProductMapper`, `src/types/catalogProduct`
- Auth session + Bearer pattern from `curation.ts` / `shoppingClick.ts`

**Weak / do-not-reuse as-is**

- Entire `app/(tabs)/search.tsx` implementation (local filter, non-interactive rows)
- product-list inline `ProductCard` (legacy `Product` type, bag stub)
- Mock `mockVideos` fallback (product-list only)
- Cart UI (provider not even in root tree; example.com buy links)

**Missing for Search V1 entities**

- Collection result card / tile
- Creator result card / profile navigation target
- Autocomplete UI
- Typed Search API client + cursor pagination UI
- Empty-query landing (trending/discovery) — **no existing ranked discovery surface**

---

## 16. Relevant APIs

### Used by FE today

| Client | Purpose |
| --- | --- |
| Supabase Auth | Session, Google OAuth, email auth |
| Supabase `videos`, `video_products`, `catalog_products` | Home + Search + product-list reads |
| `POST ${INGEST}/ingest`, `/ingest/manual`, `/publish` | Create flow |
| `GET ${INGEST}/products/:id/redirect` | Shopping (via `Linking.openURL`) |

### Backend Search (available; unused by FE)

- `GET /search`, `GET /search/autocomplete`, `POST /search/telemetry/click` (see §8)

### Not present on FE

- Collection REST, User/Creator public profile APIs, Engagement APIs, Recs UI

---

## 17. Exact file map

### Navigation

| File | Why it matters |
| --- | --- |
| `app/_layout.tsx` | Root stack + providers |
| `app/(tabs)/_layout.tsx` | Tab registration including Search |
| `app/(tabs)/create/_layout.tsx` | Nested Create stack pattern |
| `components/haptic-tab.tsx` | Tab press UX |
| `components/ui/icon-symbol.tsx` | Tab Search icon mapping |

### Search

| File | Why it matters |
| --- | --- |
| `app/(tabs)/search.tsx` | Current Search screen (placeholder) |
| `components/commerce/wrappers/SearchProductCard.tsx` | Unused ProductCard alias intended for Search |
| `components/parallax-scroll-view.tsx` | Search screen chrome |

### Collections (analogue = videos / reels)

| File | Why it matters |
| --- | --- |
| `app/(tabs)/index.tsx` | Home reel feed |
| `components/ReelItem.tsx` | Platform router for reel media |
| `components/YouTubeReelItem.tsx` | YouTube presentation |
| `components/InstagramReelItem.tsx` | Instagram presentation |
| `components/BottomDock.tsx` | Creator + products dock; nav to product-list |
| `components/Header.tsx` | Reel brand header |
| `src/mocks/videos.ts` | `Video` / `Product` types (+ mocks) |
| `src/services/supabase.ts` | Feed data access |
| `src/services/feedRefresh.ts` | Post-publish feed invalidation |
| `src/utils/videoUtils.ts` | Platform detection / embed transform |
| `src/utils/youtubeWebViewEmbed.ts` | YouTube WebView HTML |
| `src/utils/instagramWebViewEmbed.ts` | Instagram embed helpers |

### Creators

| File | Why it matters |
| --- | --- |
| `app/(tabs)/profile.tsx` | Signed-in user profile / auth UI (not public creator) |
| `contexts/AuthContext.tsx` | User session; username metadata |

### Products

| File | Why it matters |
| --- | --- |
| `components/commerce/*` | Catalog product UI system |
| `app/product-list/[id].tsx` | Per-video product list + embed |
| `src/types/catalogProduct.ts` | Catalog view-model |
| `src/services/catalogProductMapper.ts` | Row → view-model |
| `src/services/shoppingClick.ts` | Purchase redirect |
| `app/cart.tsx` | Bag screen (partial stub) |
| `contexts/CartContext.tsx` / `components/CartContext.tsx` | Cart state (duplicate; not wired in root) |

### Feed / discovery

| File | Why it matters |
| --- | --- |
| `app/(tabs)/index.tsx` | Only discovery-like surface |
| `src/services/feedRefresh.ts` | Reload signal |

### API / services

| File | Why it matters |
| --- | --- |
| `src/services/supabase.ts` | Supabase client + video reads |
| `src/services/curation.ts` | Authenticated backend fetch pattern |
| `src/services/shoppingClick.ts` | Backend redirect pattern |
| `src/types/curation.ts` | Ingest/publish DTOs |

### State

| File | Why it matters |
| --- | --- |
| `src/state/curationDraftStore.ts` | Module Map store pattern |
| `contexts/AuthContext.tsx` | Auth |
| `contexts/ThemeContext.tsx` | Titanium/Nebula |

### Design system

| File | Why it matters |
| --- | --- |
| `constants/theme.ts` | Base Colors/Fonts |
| `contexts/ThemeContext.tsx` | App chrome theme |
| `components/themed-text.tsx` / `themed-view.tsx` | Themed primitives |
| `hooks/use-color-scheme.ts` / `use-theme-color.ts` | Color helpers |
| `tailwind.config.js` / `global.css` | NativeWind present but unused |

### Telemetry

| File | Why it matters |
| --- | --- |
| `src/logging/curationLog.ts` | Log abstraction |
| `src/logging/productAnalytics.ts` | Product event names |

### Testing

| File | Why it matters |
| --- | --- |
| _(none in FE)_ | No FE tests to map |

### Create (adjacent)

| File | Why it matters |
| --- | --- |
| `app/(tabs)/create/index.tsx` | URL ingest entry |
| `app/(tabs)/create/manual.tsx` | Manual product links |
| `app/(tabs)/create/review.tsx` | Product review + `ProductDetailsSheet` |

---

## 18. Gaps / observations for future Search FE work

1. **Domain mismatch:** Backend Search V1 centers **Collections + Creators + Products**. FE still centers **Videos + Products**. There is no Collection or Creator destination screen to route Search hits into.

2. **Existing Search tab is not Search-domain ready:** Client-side filter over Supabase videos; non-clickable rows; no autocomplete, pagination, hybrid ranking, or Search telemetry.

3. **`SearchProductCard` is a name-only scaffold** — ready to mount for product hits once data is `CatalogProductViewModel`.

4. **No FE Search client** for `GET /search` / autocomplete / click telemetry; established pattern is `src/services/*` + Bearer JWT to `EXPO_PUBLIC_MYSTASH_INGEST_URL`.

5. **No discovery/trending/recs UI** to reuse for empty-query Search landing. Home feed is chronological Supabase videos only.

6. **Dual product UIs** (commerce catalog vs legacy feed `Product`) — Search should standardize on catalog view-models where possible.

7. **No FE test harness** — any Search FE quality bar must introduce tooling or accept manual QA initially.

8. **Design inconsistency:** Search screen still uses Expo template Parallax + light `TextInput`, not Titanium/Nebula reel chrome used on Home.

9. **Cart / bag** is incomplete and not provider-mounted; don’t block Search on it.

10. **NativeWind is unused** — prefer StyleSheet + existing theme tokens unless NativeWind is deliberately enabled later.

11. **Media:** Prefer existing WebView reel pipeline; do not add video hosting.

12. **Telemetry:** Mirror `product.*` / `curationLog` naming for Search client events; wire backend `/search/telemetry/click` separately from Engagement.

---

*End of audit. No implementation performed.*
