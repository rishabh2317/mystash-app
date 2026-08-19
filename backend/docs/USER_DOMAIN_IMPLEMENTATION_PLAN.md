# User Domain Implementation Plan

**Spec:** [`USER_DOMAIN_SPEC.md`](./USER_DOMAIN_SPEC.md) (canonical, frozen)  
**Status:** Implement V1 — no commit until requested  
**Template:** Mirror `backend/src/collection/` (types → lifecycle → repo → service → factory → routes → tests)

---

## Spec decisions locked (V1)

| Topic | Decision |
|-------|----------|
| Identity | `User.id = auth.users.id` (no link table) |
| Creator SoT | `creator_status`: `NONE` \| `ONBOARDING` \| `ACTIVE` \| `SUSPENDED` |
| Computed | `is_creator ≡ creator_status == ACTIVE` (never stored as SoT) |
| Account axis | `account_status` orthogonal to `creator_status` |
| Collection create/publish gate | `creator_status == ACTIVE` only |
| Ownership | Immutable; no transfer in V1 |
| Email | Auth SoT; optional `email_mirrored` one-way sync |
| Counters | Slots on User; async updates only (no Social BC yet) |
| Events | Structured logs (same pattern as Collection) |
| Block/mute/devices/prefs/verification | Out of scope (future) |

---

## Architecture

```text
Auth (Supabase) ──id──► public.users (User aggregate)
                              │
                              │ creator_status == ACTIVE
                              ▼
                    CollectionService.createDraft
                              │
UserService ──hide/restore──► Collection discovery flags
```

- **Only UserService** mutates `public.users` / username reservations
- Collection depends on a thin **`UserCreatorPort`** (gate + snapshot)
- User depends on a thin **`CollectionDiscoveryPort`** (hide on delete) — avoids circular service imports
- No Social/Safety/Notifications/Search/Feed/Recs work

---

## Implementation steps

### 1. Migration

`supabase/migrations/20260806200000_user_domain.sql`:

- `public.users` — PK = `auth.users.id`; V1 columns from spec §2 (core profile, dual statuses, locale, email_mirrored, counter slots, schema_version, soft-delete)
- `public.username_reservations` — old handle, user_id, reserved_until (90 days), redirect_to_username
- Unique lowercase `username` on users (active/non-deleted)
- RLS: owner read/update own row; public read of non-deleted public fields via policy or service-role for API
- Indexes: `username`, `(account_status)`, `(creator_status)`, `(deleted_at)`

Do **not** retarget `collections.creator_id` FK (already → `auth.users`; same UUID space).

### 2. Domain module (`backend/src/user/`)

| File | Role |
|------|------|
| `domain/types.ts` | `User`, statuses, counters, public/settings DTOs, `isCreator()` |
| `domain/lifecycle.ts` | Account + creator transition matrices + tests |
| `domain/events.ts` | Event names + payload builders |
| `observability.ts` | `emitUserEvent` → ingestLog |
| `UserRepository.ts` | Port |
| `SupabaseUserRepository.ts` | Adapter |
| `InMemoryUserRepository.ts` | Tests |
| `UserService.ts` | Write SoT |
| `factory.ts` | `createUserService(admin)` |
| `routes.ts` | HTTP |
| `ports.ts` | `UserCreatorPort`, `CollectionDiscoveryPort` |

### 3. UserService write API (V1)

| Method | Behavior |
|--------|----------|
| `ensureFromAuth` | Idempotent create: `id`, username from metadata/email, `account_status=ACTIVE`, `creator_status=NONE`, mirror email |
| `getById` / `getPublicProfile` / `getSettings` | Explicit projections |
| `updateProfile` | display_name, photo, bio, website, social_links |
| `changeUsername` | uniqueness; reserve old 90 days; emit `UsernameChanged` |
| `updateLocale` | country, language, timezone |
| `startCreatorOnboarding` | `NONE` → `ONBOARDING` |
| `completeCreatorOnboarding` | `ONBOARDING` → `ACTIVE` |
| `abandonCreatorOnboarding` | → `NONE` |
| `suspendCreator` / `reinstateCreator` | `ACTIVE` ↔ `SUSPENDED` |
| `suspendAccount` / `reinstateAccount` | `account_status` only |
| `deleteAccount` | Soft-delete + anonymize PII fields + hide Collections via port |
| `restoreAccount` | Restore + discovery restore via port |
| `applyCounters` | Contractual denorm (async callers later) |
| `syncEmailFromAuth` | One-way mirror |

### 4. Collection integration

- Add `UserCreatorPort` to `CollectionService` constructor
- `createDraft` / publish paths: `assertCanCreateCollections`
- Snapshot: prefer User public profile; fallback Auth metadata only if User row missing (should be rare after ensure)
- `CollectionRepository.hideCreatorFromDiscovery` / `restoreCreatorDiscovery` — set `feed_eligible`/`search_eligible`/`recs_eligible` false (or restore via eligibility recompute for published)
- Wire ports in Collection + User factories
- `ingestBridge` / collection routes: `ensureFromAuth` before create

### 5. HTTP (`/users`)

| Route | Auth | Notes |
|-------|------|-------|
| `POST /users/me/ensure` | JWT | Provision/sync |
| `GET /users/me` | JWT | Settings projection |
| `GET /users/:username` | optional | Public profile |
| `PATCH /users/me/profile` | JWT | Profile update |
| `POST /users/me/username` | JWT | Change username |
| `PATCH /users/me/locale` | JWT | Locale |
| `POST /users/me/creator/start` | JWT | Onboarding |
| `POST /users/me/creator/complete` | JWT | → ACTIVE |
| `POST /users/me/creator/abandon` | JWT | → NONE |
| Admin-ish creator/account suspend | JWT (same user or later admin) | V1: self not for suspend; expose service methods; optional `/admin` stubs later |

V1 HTTP: expose ensure, me, public by username, profile, username, locale, creator start/complete/abandon. Suspend/delete via service + tests; optional admin routes if trivial.

### 6. Verify

- Lifecycle unit tests
- UserService tests (InMemory): ensure, profile, username reservation, creator transitions, orthogonal suspend, delete hides collections
- CollectionService tests: stub `UserCreatorPort` with ACTIVE creator
- `npm run build` + `npm test`
- No commit

---

## Files

| Area | Path |
|------|------|
| Plan | `backend/docs/USER_DOMAIN_IMPLEMENTATION_PLAN.md` |
| Migration | `supabase/migrations/20260806200000_user_domain.sql` |
| Module | `backend/src/user/**` |
| Collection | `CollectionService.ts`, repos, factory, ingestBridge, routes, tests |
| Entry | `backend/src/index.ts` |

---

## Explicit non-goals

Social follow/block/mute, notification prefs/devices, verification, orgs, Search/Feed/Recs consumers, ownership transfer, frontend AuthContext profile fetch, SQL in Edge Functions.
