# Creator FE — Backend Gap Plan

**Status:** Planning only — **no implementation in this task**  
**Triggered by:** Phase 3 Creator FE planning (`frontend/docs/CREATOR_FE_IMPLEMENTATION_PLAN.md`)  
**Architecture:** [`../../frontend/docs/FE_DOMAIN_ARCHITECTURE_V1.md`](../../frontend/docs/FE_DOMAIN_ARCHITECTURE_V1.md) OD-6  
**Domain authority:** [`COLLECTION_DOMAIN_SPEC.md`](./COLLECTION_DOMAIN_SPEC.md), [`USER_DOMAIN_SPEC.md`](./USER_DOMAIN_SPEC.md), [`ENGAGEMENT_DOMAIN_SPEC.md`](./ENGAGEMENT_DOMAIN_SPEC.md)  
**Related code:** `backend/src/collection/`, `backend/src/user/`, `backend/src/engagement/`, `backend/src/search/`

**Non-goals:** Implement routes/repos; FE code; migrations beyond what list query needs if indexes already exist; Campaign/Brand; Search redesign; commit/push.

---

## 0. Verdict

| Capability | Status |
| --- | --- |
| Public Creator profile | **Available** — `GET /users/by-username/:username` |
| Follow / Unfollow | **Available** — Engagement JWT APIs |
| List published public Collections by creator | **Missing** — **blocking** for Creator Profile Collections section |
| Follow status for one creator | **Missing HTTP** — soft gap (`isFollowing` exists on service only) |
| Public profile by user id | **Missing** — soft gap |

**Phase naming:** treat this document as **Phase 3A (Backend)** prerequisite before Creator FE Collections (Phase 3C) can complete.

---

## 1. Investigation summary

### 1.1 Collection HTTP today (`collection/routes.ts`)

Present:

- `POST /collections`
- `GET /collections/:id`
- `GET /collections/by-slug/:slug`
- mutate/publish/media/tags routes

**Absent:** any list endpoint filtered by `creator_id` (or username).

### 1.2 Collection repository today

`CollectionRepository` / Supabase implementation support get-by-id, get-by-slug, aggregate loads, and some creator-scoped admin/hide paths — **not** a public paginated “published collections for creator” read.

Public read eligibility (existing `canRead` / eligibility rules):

```text
status === 'published'
&& visibility === 'public'
&& moderationState === 'clear'
&& deletedAt == null
```

Owner-only reads of drafts must **not** appear on public Creator Profile.

### 1.3 Search is not a substitute

`GET /search?q=…&creator_id=`

- Requires non-empty `q` (400 otherwise)
- Returns blended ranked entities (collections + creators + products)
- Not a stable chronological creator library

**Do not** document Search as the Creator Profile Collections SoT.

### 1.4 User / Engagement (non-blocking)

Already sufficient for Creator header + Follow:

- `PublicUserProfile.publicStats.collectionCount` — header hint only  
- Follow edges + User counter denorm — already wired  

---

## 2. Required contract (smallest Collection-aligned API)

### 2.1 Recommended HTTP

```http
GET /collections?creator_id=<uuid>&limit=<n>&cursor=<opaque>
```

**Why this shape**

- Keeps Collection BC as SoT (not User embedding Collections)
- Matches “list resource with filter” without inventing `/creators/:id/collections` as a second Collection API
- Extensible later (`status`, `visibility` admin filters) without breaking public default

**Alternative (acceptable if routing clarity preferred):**

```http
GET /users/:userId/collections?limit=&cursor=
```

Only if implemented as a **thin User route that delegates to CollectionService** (User must not own Collection aggregate logic). Prefer `/collections?creator_id=` to avoid User→Collection leakage.

### 2.2 Auth

- **Optional / public** — anonymous Creator Profile browse  
- Do **not** require JWT for public published lists  
- If JWT present and `creator_id === caller`, V1 still returns **public published only** on this endpoint (owner draft library is a different product surface — Create tab — not Creator Profile)

### 2.3 Query params

| Param | Required | Notes |
| --- | --- | --- |
| `creator_id` | **Yes** | UUID = `User.id` / `Collection.creator_id` |
| `limit` | No | Default 20; clamp e.g. 1–50 |
| `cursor` | No | Opaque; `published_at` + `id` keyset recommended |

Reject missing/invalid `creator_id` with `400`.

### 2.4 Response (list DTO — not full aggregate)

Avoid N+1 and over-fetch. Return **tile-ready** fields:

```json
{
  "collections": [
    {
      "id": "uuid",
      "slug": "string",
      "title": "string",
      "status": "published",
      "visibility": "public",
      "publishedAt": "ISO-8601",
      "heroThumbnailUrl": "string|null",
      "productTagCount": 0,
      "creator": {
        "id": "uuid",
        "username": "string|null",
        "displayName": "string|null",
        "avatarUrl": "string|null"
      },
      "counters": {
        "views": 0,
        "saves": 0
      }
    }
  ],
  "nextCursor": "string|null"
}
```

Notes:

- `creator` snapshot is **denormalized display** (Collection snapshot / User public fields) — User remains identity SoT  
- `productTagCount` from existing tag relations / materialized counters — do not embed Catalog products  
- Omit private/unlisted/draft/rejected/archived/deleted  
- Sort: `published_at DESC`, then `id DESC` for stability  

### 2.5 Errors

| Case | Status |
| --- | --- |
| Bad `creator_id` / limit | 400 |
| Creator unknown | **200 empty list** *or* 404 — **recommend 200 empty** (profile 404 is User’s job; avoid coupling) |
| Internal | 500 |

---

## 3. Service / repository work (planned, not implemented)

| Layer | Change |
| --- | --- |
| `CollectionRepository` | `listPublishedPublicByCreator(creatorId, { limit, cursor })` |
| `CollectionService` | Public list method applying eligibility invariants |
| `collection/routes.ts` | `GET /collections` with `creator_id` |
| Tests | Eligibility filter, pagination cursor, empty creator, clamp limit |
| Index | Confirm `(creator_id, published_at DESC)` or equivalent exists / propose migration **only if required for performance** |

**Migration rule:** do not add schema for FE convenience. Add index migration **only** if query plans require it — call out in implementation PR, not as speculative columns on User/Catalog.

---

## 4. Soft gaps (optional Phase 3A+)

### 4.1 Follow status

```http
GET /engagement/creators/:id/follow
Auth: JWT required
→ { following: boolean }
```

Wraps existing `EngagementService.isFollowing`.  
FE can ship without this using `GET /engagement/me/following`.

### 4.2 Public profile by id

```http
GET /users/by-id/:id
→ PublicUserProfile
```

Only if product needs UUID deep links. V1 Creator route is **username-based**.

---

## 5. Explicit non-solutions

| Approach | Why rejected |
| --- | --- |
| FE filtering all Collections client-side | No list-all API; unbounded |
| Search with empty `q` | Invalid; wrong ranking contract |
| Dual-write scrape of legacy `videos` by `curator_id` | Bypasses Collection domain; fights dual-write cleanup |
| Embedding Collections inside `PublicUserProfile` | Violates Collection SoT; blows profile payload |
| Durable shopping/creator campaign columns for this gap | Unrelated |

---

## 6. Implementation order (backend only)

1. Repository list + unit/in-memory tests for eligibility  
2. Service wrapper  
3. HTTP route + integration/unit route tests  
4. Optional index migration if measured  
5. Optional follow-status GET  
6. Hand off to Creator FE Phase 3C  

---

## 7. Test plan (backend)

- [ ] Published+public+clear collections returned for creator  
- [ ] Draft / private / unlisted / moderated / deleted excluded  
- [ ] Pagination: no overlap, stable order, `nextCursor` null at end  
- [ ] Invalid creator_id → 400  
- [ ] Unknown creator_id → 200 `{ collections: [], nextCursor: null }` (if that policy chosen)  
- [ ] Anonymous request succeeds  
- [ ] Does not require Product/Catalog joins for tile fields  

---

## 8. Consistency notes

| Spec | Alignment |
| --- | --- |
| Collection owns Collection truth | List lives under Collection routes/service |
| User owns identity + materialized `collectionCount` | Profile header continues to use User stats; list is authoritative for grid |
| FE OD-6 | This document closes the planning gap; implementation is Phase 3A |
| Engagement Follow | Already complete for Creator FE Follow button |
| No Catalog schema change | Tile references counts/ids only |

---

## 9. Handoff to FE

Creator FE may implement **header + Follow** against existing User/Engagement APIs immediately after planning approval.

**Collections grid** should not ship against Search workarounds; wait for this list API (or ship profile with an honest “Collections unavailable” section — product call, not a fake feed).

---

## 10. Document history

| Date | Note |
| --- | --- |
| 2026-08-12 | Confirmed list-by-creator HTTP missing; proposed smallest Collection-owned contract for Phase 3A |
