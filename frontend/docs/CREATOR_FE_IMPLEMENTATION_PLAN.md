# Creator FE Implementation Plan

**Status:** Phase 3 planning only — **no TS/TSX implementation in this task**  
**Architecture authority:** [`FE_DOMAIN_ARCHITECTURE_V1.md`](./FE_DOMAIN_ARCHITECTURE_V1.md) (FROZEN), [`FE_ARCHITECTURE_AUDIT.md`](./FE_ARCHITECTURE_AUDIT.md)  
**Domain authority:** [`../../backend/docs/USER_DOMAIN_SPEC.md`](../../backend/docs/USER_DOMAIN_SPEC.md), [`../../backend/docs/USER_DOMAIN_IMPLEMENTATION_PLAN.md`](../../backend/docs/USER_DOMAIN_IMPLEMENTATION_PLAN.md), [`../../backend/docs/COLLECTION_DOMAIN_SPEC.md`](../../backend/docs/COLLECTION_DOMAIN_SPEC.md), [`../../backend/docs/ENGAGEMENT_DOMAIN_SPEC.md`](../../backend/docs/ENGAGEMENT_DOMAIN_SPEC.md) (Engagement Follow APIs already shipped)  
**Backend gap (confirmed):** [`../../backend/docs/CREATOR_FE_BACKEND_GAP_PLAN.md`](../../backend/docs/CREATOR_FE_BACKEND_GAP_PLAN.md)  
**Related completed phases:** Product FE, OAuth intent (1.1), Cart BE/FE (2A/2B), Product Intelligence / Shopping hardening  

**Scope:** Public Creator Profile architecture, data model, Engagement Follow integration, Collection composition, auth boundary, loading/error states, files, order, tests.  
**Non-goals:** Implement code; redesign Profile tab; redesign Reel Feed / BottomDock; Product/Cart/Search ownership; migrations; commit/push.

---

## 0. Executive summary

Public Creator Profile is a **new stack route** that composes:

| Concern | Owner |
| --- | --- |
| Identity / bio / avatar / stats | **User** (`PublicUserProfile`) → FE `CreatorViewModel` |
| Follow / Unfollow | **Engagement** (existing JWT APIs) |
| Published Collections grid | **Collection** list API (**gap**) → FE `CollectionViewModel` + **canonical `CollectionTile`** |
| Open Collection | Phase 4 focused Reel host (reuse reel media; **do not** redesign Home Feed) |

**Profile tab (`/(tabs)/profile`) stays account/settings.** Do not merge public Creator into it.

**Blocking prerequisite:** list published public Collections by creator (OD-6). See gap plan → **Phase 3A backend** before Creator Collections UI can be complete.

---

## 1. Current Creator architecture audit

### 1.1 Backend (verified in repo)

| Capability | Status | Evidence |
| --- | --- | --- |
| Public profile by username | **Ready** | `GET /users/by-username/:username` → `{ user: PublicUserProfile }` (no JWT) |
| Username redirect | **Ready** | `301 { redirect_to_username }` on active reservation |
| Hidden/unavailable account | **Ready** | Service hides `DELETED` / `SUSPENDED` / soft-deleted → FE sees 404 |
| Public profile by user id | **Missing** | No `GET /users/:id` |
| Follow / Unfollow | **Ready** | `POST` / `DELETE /engagement/creators/:id/follow` (JWT) |
| List my following | **Ready** | `GET /engagement/me/following` (JWT) |
| Follow status for one creator | **Service only** | `EngagementService.isFollowing` — **no HTTP** |
| Follower count denorm | **Ready** | Engagement → `UserService.applyCounters` → `publicStats.followersCount` |
| List Collections by creator | **Missing** | No Collection HTTP list; repo has no `listPublishedPublicByCreator` |
| Search `creator_id` filter | **Not a list API** | `GET /search` requires `q`; blended ranking — **do not** use as Creator Profile SoT |

Canonical Creator identity: **User with `creatorStatus`** — not a separate Creator entity (`USER_DOMAIN_SPEC`).

### 1.2 Frontend (verified in repo)

| Asset | Reality |
| --- | --- |
| Public Creator route | **None** — no `app/creator/**` |
| Focused Reel route | **None** — no `app/reel/**` |
| `CreatorCard` / `CreatorProfile` | **None** |
| `CollectionTile` / `CollectionViewModel` | **None** |
| User / Engagement API clients | **None** (`src/services` has cart/curation/shopping/supabase) |
| Profile tab | **Account** — auth, theme, placeholders; does **not** call User domain public profile |
| Auth intent | **ADD_TO_CART only** (`src/navigation/authIntent.ts`) |
| Home | In-tab Reel `FlatList` (protected); BottomDock → `/product-list/[id]` |
| Search tab | Legacy client filter over Supabase videos — no Search HTTP |

### 1.3 Architecture freeze reminders

From `FE_DOMAIN_ARCHITECTURE_V1.md`:

- Browse Creator Profile **without** auth; Follow requires Login → intent resume  
- Creator ≠ Profile tab  
- One `CollectionTile` shared across Creator / Search / Saved  
- Product / Cart / Shopping / Save / Search remain out of Creator ownership  

---

## 2. Canonical Creator data model

### 2.1 Source of truth

**Backend:** `PublicUserProfile` (`backend/src/user/domain/types.ts`) via User BC.  
**FE:** map once to `CreatorViewModel` — do **not** invent a second Creator entity or parallel SearchCreator SoT.

### 2.2 Proposed `CreatorViewModel` (FE)

| Field | Source | Notes |
| --- | --- | --- |
| `userId` | `user.id` | Engagement follow target |
| `username` | `user.username` | Route key |
| `displayName` | `user.displayName` | Fallback to `@username` in UI |
| `avatarUrl` | `user.profilePhotoUrl` | |
| `bio` | `user.bio` | Optional |
| `websiteUrl` | `user.websiteUrl` | Optional |
| `socialLinks` | `user.socialLinks` | Optional |
| `creatorStatus` | `user.creatorStatus` | `NONE` \| `ONBOARDING` \| `ACTIVE` \| `SUSPENDED` |
| `isCreator` | `user.isCreator` | Derived (`ACTIVE`) — display convenience |
| `accountType` | `user.accountType` | Optional chrome |
| `joinedAt` | `user.joinedAt` | Optional |
| `followersCount` | `user.publicStats.followersCount` | Materialized User counter |
| `followingCount` | `user.publicStats.followingCount` | Optional on profile |
| `collectionCount` | `user.publicStats.collectionCount` | Header signal; list is Collection SoT |
| `isFollowing` | Engagement (client) | **Not** on public profile DTO; omit when logged out |

### 2.3 Composition (not ownership)

```text
CreatorProfile screen
  ├── CreatorViewModel          ← User
  ├── isFollowing / Follow UI   ← Engagement
  └── CollectionTile[]          ← Collection list API → CollectionViewModel
        └── (later) open Reel   ← Phase 4 focused host
```

- **Catalog** remains Product SoT (never nested as Creator-owned products).  
- **Collection** remains Collection SoT.  
- Creator Profile **composes** these domains.

### 2.4 Status presentation

| Backend condition | FE treatment |
| --- | --- |
| 200 + profile | Render profile |
| 301 `redirect_to_username` | `router.replace` to new username |
| 404 | Creator not found |
| Profile exists but `creatorStatus !== ACTIVE` | Still show public identity if User allows public read; Collections list may be empty. Do **not** invent “trending” filler |
| Account SUSPENDED/DELETED | Backend already hides → 404 “unavailable / not found” |

---

## 3. Existing backend APIs (consume as-is)

### 3.1 Public profile

```http
GET /users/by-username/:username
→ 200 { user: PublicUserProfile }
→ 301 { redirect_to_username }
→ 404 { error }
```

Auth: **none**. Base URL: `EXPO_PUBLIC_MYSTASH_INGEST_URL` (same as `cartApi`).

### 3.2 Follow (Engagement)

```http
POST   /engagement/creators/:id/follow
DELETE /engagement/creators/:id/follow
Body (optional): { "event_id": "<uuid>" }
Auth: Bearer <supabase access_token>
→ POST 200 { ok, edge_id, state }
→ DELETE 200 { ok: true }
→ 400 self-follow / domain errors
```

```http
GET /engagement/me/following
→ { following: [{ creator_id, updated_at }] }
```

**Do not** create a new Follow system. FE Engagement client only.

### 3.3 Collection single-read (already exists; not a list)

```http
GET /collections/:id
GET /collections/by-slug/:slug
```

Useful after Phase 4 focused Reel / deep links — **not** sufficient for Creator Profile grid.

---

## 4. Missing backend APIs

| Gap | Blocking? | Plan |
| --- | --- | --- |
| List published public Collections by `creator_id` (cursor pagination) | **Yes** for Collections section | Phase **3A** — [`CREATOR_FE_BACKEND_GAP_PLAN.md`](../../backend/docs/CREATOR_FE_BACKEND_GAP_PLAN.md) |
| `GET` follow status for one creator | Soft | Prefer small `GET /engagement/creators/:id/follow` **or** use `me/following` + match (OK for V1 if following list stays small) |
| Public profile by UUID | Soft | Only if deep links use id; V1 route is **username** |

**Explicitly rejected as Creator list SoT:** empty-query Search or `creator_id` Search filter without a dedicated Collection read contract.

---

## 5. Creator Profile route

### 5.1 Decision

| Choice | Rationale |
| --- | --- |
| **`/creator/[username]`** | Matches frozen FE architecture; public; stable shareable handle; aligns with `GET /users/by-username/:username` |
| Not `/(tabs)/profile` | Profile tab = signed-in account |
| Not `/user/[id]` for V1 | No public-by-id API; username is User SoT handle |
| Stack route under root `app/_layout.tsx` | Same pattern as `/cart`, `/product-list/[id]` — outside BottomDock tabs |

### 5.2 File

- **Create:** `app/creator/[username].tsx`  
- Register automatically via Expo Router file convention (add to root Stack if explicit screens list is required — mirror `cart` / `product-list`)

### 5.3 Navigation (Phase 3 entry points)

Phase 3 may land the route even if few callers exist yet:

| From | When |
| --- | --- |
| Deep link / share | `/creator/{username}` |
| Future Search `CreatorCard` | Phase 6 |
| Future Reel attribution | Phase 8 (protected Feed — **no** Feed redesign in Phase 3) |
| Optional: self “View public profile” from Profile tab | Thin link only — **do not** redesign Profile tab |

### 5.4 Redirect handling

On `301 redirect_to_username`, replace route params to the new username and refetch (avoid broken bookmarks after rename).

---

## 6. Creator Profile component architecture

```text
app/creator/[username].tsx          ← screen: fetch, auth gate wiring, layout
  └── CreatorProfile                ← presentation composition
        ├── CreatorProfileHeader    ← avatar, name, @username, bio, stats
        ├── FollowControl           ← UI only; callbacks from parent/hook
        └── CreatorCollectionList   ← layout only; maps CollectionTile[]
              └── CollectionTile    ← canonical Collection presentation
```

### 6.1 Responsibilities

| Component | Owns | Does not own |
| --- | --- | --- |
| Screen | Data fetch, pagination, auth orchestration hooks, navigation | Domain SoT |
| `CreatorProfile` | Layout composition | API calls, auth |
| `CreatorProfileHeader` | Identity chrome | Follow persistence |
| `FollowControl` | Button pending/label states via props | `useAuth`, router, Engagement HTTP |
| `CreatorCollectionList` | Grid/list layout, empty slot | Collection entity logic |
| `CollectionTile` | Collection presentation | Creator-specific styling forks |
| `CreatorCard` | Compact row for Search/lists (can ship with Phase 3 for reuse) | Full profile |

### 6.2 Forbidden

- `CreatorCollectionCard` / `CreatorProductCard` forks  
- Auth / `fetch` inside pure presentation components  
- Embedding ProductCard on Creator Profile in Phase 3 (Products appear later via Collection → Reel → existing Product architecture)

---

## 7. Collection composition

### 7.1 Canonical tile

Per FE architecture §9.2: **`CollectionTile`** is the only Collection card.

**Minimal V1 tile props (owned by Collection FE domain, introduced for Creator):**

- `collection: CollectionViewModel`  
- `onPress(collection)`  
- optional `variant` later — default one look for Creator / Search / Saved  

**`CollectionViewModel` (list DTO → FE):** id, slug, title, heroThumbnailUrl, creator snapshot (display only), productCount, publishedAt, optional save/view signals.

### 7.2 Phase boundary with Phase 4

| Deliverable | Phase |
| --- | --- |
| `CollectionViewModel` + `CollectionTile` primitives | **Phase 3** (needed by Creator grid) — Collection domain ownership, not Creator-owned cards |
| Focused Reel host `/reel/[collectionId]` | **Phase 4** |
| Wire `CollectionTile.onPress` → focused Reel | **Phase 4** (Phase 3 may no-op / toast / defer) |
| Home Reel Feed redesign | **Never in Phase 3–7** |

### 7.3 Data flow

```text
GET /collections?creator_id=&cursor=&limit=   (Phase 3A)
        ↓
collectionListMapper → CollectionViewModel[]
        ↓
CreatorCollectionList → CollectionTile
        ↓
onPress → Phase 4 /reel/[collectionId]
```

Do **not** N+1 `GET /collections/:id` for each tile on the profile grid.

---

## 8. Follow / Unfollow integration

### 8.1 Client

**Create** `src/services/engagementApi.ts` (mirror `cartApi.ts`):

- `followCreator(creatorId, accessToken, eventId?)`  
- `unfollowCreator(creatorId, accessToken, eventId?)`  
- `listFollowing(accessToken)`  

Optional later: `getFollowStatus(creatorId)` if backend adds GET.

### 8.2 UI flow

```text
Logged in + Follow
  → engagementApi.followCreator(userId)
  → optimistic isFollowing + followersCount±1 (rollback on error)

Logged in + Unfollow
  → engagementApi.unfollowCreator(userId)
  → inverse optimistic update
```

Idempotent backend follow: safe to retry.

### 8.3 Initial `isFollowing`

V1 options (prefer smallest):

1. If authenticated on profile load → `GET /engagement/me/following` and set `isFollowing = following.some(c => c.creator_id === userId)`  
2. Soft backend improvement: dedicated status GET (gap plan optional)

Do **not** call following list when logged out.

### 8.4 Self profile

If `session.user.id === creator.userId`: hide Follow or show disabled “You” — backend already rejects self-follow (`400`).

---

## 9. Authentication boundary

### 9.1 Rules (frozen)

- Logged-out users **may view** Creator Profile + Collections  
- Follow **requires** authentication  
- **No** auth logic inside `CreatorProfile` / `FollowControl` presentation  

### 9.2 Reuse Phase 1.1 intent pattern

Extend `src/navigation/authIntent.ts` (do not invent a second store):

| Intent | Params | Resume |
| --- | --- | --- |
| Existing `ADD_TO_CART` | `catalogProductId` | unchanged |
| **New** `FOLLOW_CREATOR` | `creatorId` (+ optional `username` for return navigation) | After auth → `engagementApi.followCreator` → navigate back to `/creator/[username]` |

Mirror:

- `buildFollowCreatorLoginHref`  
- OAuth `appendAuthIntentToRedirectUrl` support for Follow  
- `auth/callback` → Profile with intent (existing pipeline) **or** enhance resume to return to Creator route after Follow  
- Orchestration hook e.g. `useCreatorFollowHandler` (parallel to `useProductAddToCartHandler`)

**Recommended V1 resume UX:** complete Follow, then `router.replace('/creator/' + username)` so user lands back on the public profile (better than staying on Profile tab). Clear intent params after success.

### 9.3 What stays on Profile tab

Account settings only. Intent **consume** may remain Profile-mounted (as Cart does today) if that is the OAuth landing — orchestration then redirects to Creator. Do **not** turn Profile into Creator UI.

---

## 10. Loading / empty / error states

| State | UX |
| --- | --- |
| Creator loading | Header skeleton / spinner — no fake content |
| Creator not found (404) | Dedicated empty: “Creator not found” + back |
| Creator unavailable | Same as not found if backend hides suspended/deleted |
| Username redirect (301) | Silent replace + reload |
| Collections loading | Grid placeholders under header (header may already be ready) |
| No Collections | Honest empty: “No collections yet” — **no** trending/filler |
| Collections pagination | Footer spinner / “Load more”; preserve scroll |
| Follow pending | Button disabled / spinner; prevent double-tap |
| Follow API failure | Rollback optimistic state; inline error / retry on control |
| Profile API failure | Full-screen error + Retry |
| Collections API failure | Section error + Retry (keep header if loaded) |
| Offline / network | Same retry pattern as Cart FE |

---

## 11. Pagination

| Resource | Strategy |
| --- | --- |
| Creator profile | Single GET — no pagination |
| Collections | Cursor + `limit` (default 20) from Phase 3A list API |
| Following list (status bootstrap) | Single `me/following` (limit 100 server-side today) — acceptable V1; revisit if lists grow |

Infinite scroll or explicit “Load more” on Creator Collections — prefer FlatList/`onEndReached` consistent with app patterns.

---

## 12. Caching / state ownership

| Layer | Choice |
| --- | --- |
| Framework | **No** Redux / Zustand / React Query (architecture freeze) |
| Creator profile | Screen-local state (+ cancelled fetch flags) |
| Collections pages | Screen-local pages/cursor |
| Follow state | Screen-local `isFollowing` + optimistic counts; optionally refresh `publicStats` after success |
| Cross-screen Creator cache | **Defer** until duplication pain (Search + Profile) |

**Do not** put Following graph in Profile tab state.  
**Do not** store Collections on User client as SoT.

### 12.1 Fetch strategy

**Prefer separate endpoints** (matches domain boundaries):

1. `GET /users/by-username/:username`  
2. `GET /collections?creator_id=…` (after 3A)  
3. Optional parallel: `GET /engagement/me/following` when authed  

**Avoid** inventing a BFF “Creator aggregate” in Phase 3 unless latency forces it later.  
`publicStats.collectionCount` is a header hint only — grid comes from Collection list.

Parallelize (1)+(2)+(3) on mount to avoid sequential waterfalls (not N+1).

---

## 13. Exact files expected to change (when implementing)

### 13.1 Create

| File | Role |
| --- | --- |
| `app/creator/[username].tsx` | Public Creator Profile screen |
| `src/types/creator.ts` | `CreatorViewModel` |
| `src/services/userApi.ts` | Public profile client |
| `src/services/engagementApi.ts` | Follow / unfollow / me/following |
| `src/services/collectionApi.ts` (or extend) | List-by-creator client (after 3A) |
| `src/mappers/creatorMapper.ts` | `PublicUserProfile` → `CreatorViewModel` |
| `src/mappers/collectionMapper.ts` | List DTO → `CollectionViewModel` |
| `src/types/collection.ts` | `CollectionViewModel` |
| `components/creator/CreatorProfile.tsx` | Composition |
| `components/creator/CreatorProfileHeader.tsx` | Header |
| `components/creator/CreatorCard.tsx` | Compact (Search-ready) |
| `components/creator/CreatorCollectionList.tsx` | Grid layout |
| `components/collection/CollectionTile.tsx` | Canonical tile |
| `components/engagement/FollowControl.tsx` | Follow button UI |
| `src/services/creatorFollowOrchestration.ts` (name flexible) | Auth gate + follow — **outside** presentation |

### 13.2 Modify

| File | Change |
| --- | --- |
| `src/navigation/authIntent.ts` | Add `FOLLOW_CREATOR` + parsers/href/OAuth append |
| `app/(tabs)/profile.tsx` | Resume Follow intent (parallel to ADD_TO_CART); optional “View public profile” link only |
| `app/auth/callback.tsx` | Forward Follow intent params if not already generic |
| `contexts/AuthContext.tsx` | Only if Google redirect helper needs Follow intent typing |
| `app/_layout.tsx` | Register stack screen if required by explicit Stack.Screen list |

### 13.3 Backend (Phase 3A — separate task)

See gap plan — Collection list route + repo method + tests. **Not** in this FE planning doc’s implementation.

---

## 14. Protected files (do not change in Phase 3)

| Area | Files / surfaces |
| --- | --- |
| Reel Feed | `app/(tabs)/index.tsx`, `components/ReelItem*`, feed paging |
| BottomDock | `components/BottomDock*` (no Creator nav wiring required in Phase 3) |
| Product FE | `components/commerce/ProductCard*`, ProductDetailsSheet contracts |
| Cart | `app/cart.tsx`, `contexts/CartContext.tsx`, `src/services/cartApi.ts` |
| Search | Do not canonicalize Search in Phase 3 (`app/(tabs)/search.tsx` leave as-is unless a tiny CreatorCard demo is explicitly requested — default **leave**) |
| Discovery / trending | None — do not invent |
| Profile tab redesign | No layout/IA rewrite — intent resume + optional link only |
| Shopping / PI | Out of scope |

---

## 15. Implementation order

```text
Phase 3A — Backend (blocking for Collections section)
  1. Collection list-by-creator API + tests (gap plan)
  2. Optional: follow-status GET

Phase 3B — FE foundation
  3. CreatorViewModel + userApi + mapper
  4. Route app/creator/[username].tsx + header/loading/error/not-found
  5. engagementApi + FollowControl + orchestration + FOLLOW_CREATOR intent
  6. Auth resume → follow → return to Creator route

Phase 3C — Collections composition
  7. CollectionViewModel + CollectionTile (canonical)
  8. CreatorCollectionList + pagination + empty/error
  9. Wire list API client

Phase 3D — Open Collection (soft / handoff)
 10. onPress stub or hand off to Phase 4 /reel/[collectionId]
```

**Ship criteria for “Phase 3 Creator FE done”:**

- Public profile browse works logged out  
- Follow/Unfollow works with auth + intent resume  
- Collections grid works against Phase 3A API (or section explicitly gated until 3A lands)  
- Profile tab unchanged as account surface  
- Reel Feed / BottomDock untouched  

---

## 16. Test plan

### 16.1 Manual / QA

- [ ] Open `/creator/{username}` logged out — profile loads  
- [ ] Follow → Login → resume Follow → back on Creator; `isFollowing` true  
- [ ] Unfollow toggles and updates count optimistically with rollback on failure  
- [ ] Self profile: no broken self-follow  
- [ ] Unknown username → not-found  
- [ ] Renamed username 301 → lands on new handle  
- [ ] Creator with zero collections → honest empty  
- [ ] Pagination loads next page without duplicating tiles  
- [ ] Collections section error retry does not remount entire app wrongly  
- [ ] Profile tab still auth/settings; Cart ADD_TO_CART intent still works  
- [ ] Home Reel / BottomDock visually and navigationally unchanged  

### 16.2 Automated (when FE harness exists / BE for 3A)

- BE: list-by-creator eligibility + pagination tests (gap plan)  
- FE unit: mappers; `parseFollowCreatorIntent`; orchestration gate branches (logged in/out)  
- No requirement to add Detox in Phase 3 unless already present  

---

## 17. Open questions

| ID | Question | Suggestion |
| --- | --- | --- |
| CQ-1 | Ship Creator header+Follow before 3A Collections API? | **Yes** — progressive; Collections section “Unavailable / coming” only if product accepts; prefer 3A first for “complete” profile |
| CQ-2 | Follow status via `me/following` vs new GET? | V1: `me/following`; add GET if latency/size hurts |
| CQ-3 | Return path after Follow login | Prefer `/creator/[username]` over staying on Profile |
| CQ-4 | Show non-ACTIVE creators’ public profiles? | Follow User public-read rules; empty collections OK |
| CQ-5 | Phase 3 `CollectionTile.onPress` before Phase 4 Reel? | Defer navigation or no-op; **do not** open Home Feed hacks |
| CQ-6 | Expose “View public profile” on Profile tab? | Optional one-liner link using session username — no redesign |
| CQ-7 | Doc path `GET /users/:username` vs implemented `/users/by-username/:username` | FE must call **implemented** path |

---

## 18. Consistency audit — `FE_DOMAIN_ARCHITECTURE_V1`

| Architecture rule | Phase 3 plan |
| --- | --- |
| Public Creator ≠ Profile tab | Separate `/creator/[username]` |
| Browse public; Follow auth-gated | §9 |
| CreatorViewModel from User public profile | §2 |
| Follow via Engagement only | §8 |
| CollectionTile shared; no Creator-specific cards | §7 |
| No Reel Feed redesign | Protected §14 |
| No guest Follow | Auth intent |
| No premature global state framework | Screen-local §12 |
| Search does not own Creator | Creator domain owns profile; Search consumes `CreatorCard` later |
| Product/Cart out of Creator | §0 / protected |
| OD-6 list-by-creator | Confirmed gap → 3A doc |
| Intent resume OD-12 | Extend route params; no AsyncStorage intent store |

**Drift to record:** Architecture Phase order puts CollectionTile in Phase 4; this plan introduces **minimal CollectionTile in Phase 3** as a shared Collection-domain primitive required by Creator Profile, with focused Reel navigation remaining Phase 4. This is a sequencing clarification, not a redesign of Collection ownership.

---

## 19. Consistency audit — User / Creator / Collection / Engagement domains

| Domain rule | Phase 3 plan |
| --- | --- |
| Creator = User + `creator_status` (no Creator entity) | Single `CreatorViewModel` from `PublicUserProfile` |
| User owns materialized follower/collection counts | Display from `publicStats`; edges owned by Engagement |
| Collection.creator_id → User.id | List filter by that id |
| Public Collection read = published + public + clear + not deleted | Enforced by Phase 3A API (gap plan) |
| Collection snapshot ≠ User SoT | Tile may show snapshot; profile header uses User |
| Engagement owns Follow edges | FE calls Engagement HTTP only |
| USER_DOMAIN “Social BC owns follow” vs shipped Engagement Follow | **Consume Engagement (shipped).** Do not wait for Social BC. Note: User spec’s “Social” is future naming; runtime SoT for edges is Engagement |
| `COLLECTION_DOMAIN_IMPLEMENTATION_PLAN.md` | **Not present in repo** — planning uses SPEC + live `collection/` code |
| Catalog Product SoT | Untouched |

---

## 20. Product / Cart / Shopping reminder

Creator Profile **does not** implement ProductCard, Cart, or Shopping.  
When users open a Collection (Phase 4+) into Reel / product-list, reuse frozen Product FE + Cart auth orchestration.

---

## 21. Document history

| Date | Note |
| --- | --- |
| 2026-08-12 | Phase 3 Creator FE plan only; backend gap confirmed and split to `CREATOR_FE_BACKEND_GAP_PLAN.md` |
