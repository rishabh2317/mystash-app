# Mystash User Domain Specification

**Status:** Canonical domain specification (no SQL, no Prisma, no APIs, no code)  
**Audience:** Platform identity & account foundation (10-year horizon)  
**Principle:** Mystash has **one User** aggregate. A **Creator is a User with creator capabilities** — not a separate entity.  
**Depends on (frozen):** Collection, CollectionMedia, CollectionProductTags, Product Intelligence, Catalog, Commerce  

Related: [`COLLECTION_DOMAIN_SPEC.md`](./COLLECTION_DOMAIN_SPEC.md), [`COLLECTION_MEDIA_DOMAIN_SPEC.md`](./COLLECTION_MEDIA_DOMAIN_SPEC.md)

---

## 0. Definition

A **User** is the single identity and account root for Mystash: authentication subject, public profile, private account state, and account lifecycle.

```text
User (aggregate root)
  ├── Public profile (handle, display, bio, …)
  ├── Private account (mirrored email for Settings, locale, …)
  ├── account_status  → can this person log in / use the account?
  ├── creator_status  → can this person publish Collections?
  └── Materialized counts (followers/following/collections) — not graph SoT
```

**Two independent status axes**

| Axis | Field | Answers |
|------|-------|---------|
| Account | `account_status` | Can this person log in and use the product as a user? |
| Creator | `creator_status` | Can this person create / publish Collections? |

These concerns must not be collapsed. Example: `account_status = ACTIVE` + `creator_status = SUSPENDED` → browse and engage; **cannot** publish.

**Creator capability**
- Every Creator **is** a User whose `creator_status` progresses through onboarding to `ACTIVE` (and may later be suspended). **No separate Creator entity.**
- **Computed convenience:** `is_creator ≡ (creator_status == ACTIVE)`. Prefer storing/querying `creator_status`; treat `is_creator` as derived, not a second source of truth.
- **Only Users with `creator_status = ACTIVE` may create draft or published Collections.**
- Collection ownership (`Collection.creator_id`) references **`User.id`**, and **`User.id = auth.users.id`** (no link table).
- Collection **creator snapshot** is denormalized from User public profile (SoT remains User).

**User is not:** a Collection, a Catalog product, a shopping cart, a search index, a recommendation model, an analytics event store, an engagement graph, or a social safety graph (follow/block/mute).

### 0.1 Specification phases

| Layer | Role |
|-------|------|
| **Canonical Domain Model** | This entire document — source of truth for identity, ownership, and relationships over 10 years |
| **V1 Implementation** | Subset required today: identity aligned to Auth, core public profile, `creator_status` + `account_status`, locale basics, Collection ownership (immutable), async counter slots |
| **Future Extensions** | Defined here but **inactive** until a later phase: verification programs, creator category, orgs, business depth, notification/privacy preference surfaces, devices, rec preference seeds, public metadata bag, Social/Safety graphs |

V1 must not invent alternate aggregates. Future fields may exist as nullable/unused without becoming mandatory behaviour.

---

## 1. Responsibilities

### 1.1 What User owns

| Responsibility | Meaning | Phase |
|----------------|---------|-------|
| **Identity** | Stable `User.id` (= `auth.users.id`) | Canonical / V1 |
| **Public profile (core)** | Handle, display name, photo, bio, website, social links | Canonical / V1 |
| **Account lifecycle** | `account_status` — login / account usability | Canonical / V1 |
| **Creator lifecycle** | `creator_status` — Collection publish eligibility on the same User | Canonical / V1 |
| **Account type** | e.g. `personal` \| `business` (no Organization BC in V1) | Canonical; V1 may use `personal` only or allow `business` as a flag |
| **Private account (minimal)** | Denormalized email for Settings **read** (Auth remains SoT); phone optional later | Canonical / V1 email mirror |
| **Locale defaults** | Country, language, timezone | Canonical / V1 |
| **Materialized public stats** | Denorm counts (followers, following, collection_count) — **not** event/edge SoT | Canonical; V1 slots OK, Social may be inactive |
| **Domain events** | UserCreated, ProfileUpdated, CreatorStatusChanged, … | Canonical / V1 |

### 1.2 What User must NEVER own

| Must not own | Owning context |
|--------------|----------------|
| Collection content, lifecycle, tags, search source fields | **Collection** |
| External media references / processing | **CollectionMedia** |
| Product truth, offers | **Catalog** / **Commerce** |
| Search inverted index / vectors | **Search** |
| Ranking models / embeddings | **Recommendations** |
| Click/view/like/save **event streams** | **Analytics** / **Engagement** |
| Notification **delivery**, templates, **device push tokens** | **Notifications** |
| Follow **edges** / follower lists | **Social** BC |
| Block / mute **relationships** | **Social / Safety** BC |
| Shopping carts, affiliate credentials | **Commerce** |
| Auth secrets (passwords, refresh tokens, MFA) | **Auth provider** |

### 1.3 Boundary map

```text
┌─────────────────────────────────────────────┐
│                 USER DOMAIN                  │
│  identity · profile · locale · denorm counts │
│  account_status · creator_status             │
└───────┬───────────────────┬─────────────────┘
        │ owns (if creator_status = ACTIVE)
        ▼
   Collections ← creator snapshot from User
   (ownership immutable in V1)
        │
        ├── CollectionMedia
        └── ProductTags → Catalog → Commerce

Social / Safety (follow, block, mute) ──async──► User counters only
Notifications (devices, delivery) ← prefs future; tokens not on User
Search / Feed / Recs / Analytics / Engagement
        consume User public fields + events (no User graph writes)
```

---

## 2. Identity (core account)

Design fields for the **User core** (public + private split enforced at read/API layers).

| Field | Purpose | Datatype | Nullable | Public? | Phase | Owner | Populated | Changes | Notes |
|-------|---------|----------|----------|---------|-------|-------|-----------|---------|-------|
| `id` | Stable PK | UUID | no | opaque | V1 | User | On create = **`auth.users.id`** | Never | **Identical to auth.users.id; no link table** |
| `auth_provider` | Primary signup provider hint | string | yes | no | V1 | User | On signup | Rare | Multi-provider identities = future child |
| `username` | Unique handle | string | no | yes | V1 | User | Signup / claim | Username change | Lowercase unique; see §19 |
| `display_name` | Human name | string | yes | yes | V1 | User | Signup / profile | Profile update | |
| `profile_photo_url` | Avatar | string URL | yes | yes | V1 | User | Upload/URL | Profile update | |
| `bio` | Short bio | string | yes | yes | V1 | User | Profile | Profile update | Length-capped |
| `account_status` | Account usability / login axis (§11) | enum | no | limited | V1 | User | `CREATED` / `ACTIVE` | Account transitions | **Independent of `creator_status`** |
| `creator_status` | Creator / publish eligibility axis | enum | no | yes (or derived) | V1 | User | Default `NONE` | Creator transitions | **Canonical creator SoT**; see values below |
| `account_type` | `personal` \| `business` (extensible) | enum | no | yes | V1: personal (+ optional business flag) | User | Default `personal` | Rare | **No Organization BC in V1** |
| `country` | Home country | string | yes | optional | V1 | User | Signup / settings | Settings | |
| `language` | Preferred language | BCP-47 | yes | no | V1 | User | Signup / settings | Settings | |
| `timezone` | IANA tz | string | yes | no | V1 | User | Detect / settings | Settings | |
| `joined_at` | Account created | timestamp | no | yes | V1 | User | On create | Never | |
| `deleted_at` | Soft delete | timestamp | yes | no | V1 | User | On delete | Restore clears | |
| `email_mirrored` | Settings display copy of Auth email | string | yes | no | V1 optional | User | Sync **from Auth only** | Never written as SoT | Auth is email SoT |
| `is_verified` | Verification badge | bool | no | yes | **Future** | User / T&S | Default false | T&S | Inactive until verification program |
| `creator_category` | Creator vertical | string | yes | yes | **Future** | User | Creator onboarding | Update | |
| `banner_url` | Profile header | string | yes | yes | **Future** | User | Profile | Update | |
| `schema_version` | Domain version | int | no | no | V1 | User | Create | Upgrades | |
| `extensions` | Experimental map | object | yes | no | Future-friendly | User | Features | Rare | |

### 2.1 `creator_status` (canonical)

| Value | Meaning |
|-------|---------|
| `NONE` | Not a creator; cannot create Collections |
| `ONBOARDING` | Creator onboarding / application in progress; cannot publish yet |
| `ACTIVE` | May create draft and published Collections |
| `SUSPENDED` | Creator privileges revoked (moderation / policy); account may still be usable for browsing |

**Computed (not stored as SoT):** `is_creator = (creator_status == ACTIVE)`.

Do **not** use a stored boolean `is_creator` as the domain field. Derived reads/DTOs may expose `is_creator` for convenience.

`creator_status` supports onboarding, creator suspensions, rejected applications (remain/return to `NONE` or stay non-`ACTIVE` by policy), and future verification workflows **without** a later schema split.

### 2.2 `account_status` vs `creator_status`

| | `account_status` | `creator_status` |
|--|------------------|------------------|
| Question | Can this person log in / use the account? | Can this person publish Collections? |
| Example | `SUSPENDED` → no (or limited) login | `SUSPENDED` → cannot publish; may still browse if account is `ACTIVE` |
| Orthogonal | Yes | Yes |

Account suspension and creator suspension are **different operations**.

**Auth secret material** stays in the Auth provider. User stores non-secret profile/account state only.

---

## 3. Public profile

Public profile is the subset of User safe for Profile pages, Feed cards, Search, and Collection snapshots.

| Field | Purpose | Public | Phase |
|-------|---------|--------|-------|
| `username` (handle) | `@handle` | yes | V1 |
| `display_name` | Name | yes | V1 |
| `profile_photo_url` | Avatar | yes | V1 |
| `bio` | About | yes | V1 |
| `website_url` | Link out | yes | V1 |
| `social_links` | Platform → URL | yes | V1 (may be empty) |
| `creator_status` | Creator lifecycle (or derived `is_creator`) | yes | V1 |
| `account_type` | personal/business/… | yes | V1 |
| `joined_at` | Member since | yes | V1 |
| `public_stats` | Materialized counts | yes | V1 slots; Social may be inactive |
| `banner_url` | Header | yes | **Future** |
| `creator_category` | Vertical | yes | **Future** |
| `is_verified` | Badge | yes | **Future** |
| `public_metadata` | Curated extras | yes | **Future** |

**Collection snapshot mapping**

| Collection denorm | User SoT |
|-------------------|----------|
| `creator_id` | `User.id` (= auth.users.id) |
| `creator_name` | `display_name` |
| `creator_username` | `username` |
| `creator_avatar` | `profile_photo_url` |
| `creator_verified` | `is_verified` (false until verification ships) |

Refresh Collection snapshots on `ProfileUpdated` / `UsernameChanged` (and later verification events).

---

## 4. Private account

Never expose on public Profile, Feed, Search, or Collection APIs.

| Field / area | Purpose | Phase |
|--------------|---------|-------|
| Email (mirrored) | Settings UI read model; **Auth is SoT**; never update email from User writes | V1 |
| Phone | Optional contact | Future |
| `notification_settings` | Channels, categories, quiet hours | **Future** (User may own prefs later; delivery/tokens elsewhere) |
| `privacy_settings` | Who can follow, appear in search, etc. | **Future** |
| `content_preferences` | Explicit interest seeds for Recs | **Future** |
| Legal / consent timestamps | Terms, marketing opt-in | V1 as needed |
| Internal admin notes refs | T&S pointers | Future / Admin |

**Explicitly not on User:** `blocked_user_ids`, `muted_user_ids`, device push tokens.

**Rule:** Public profile DTO is an explicit projection, never `SELECT *`.

---

## 5. Follow & safety (ownership only — do not implement)

| Concern | Owner | Notes |
|---------|-------|-------|
| Follow **edges** | **Social** BC | Defined now; **not implemented yet** |
| Follow **events** | Social / Analytics | Append-only |
| **followers_count** / **following_count** | **User** (materialized) | Updated **asynchronously** via contractual denorm from Social/Analytics events |
| Block / mute **relationships** | **Social / Safety** BC | **Not owned by User**; User must not store block/mute graphs |
| Optional block/mute **counts** | User denorm (if ever needed) | Counts only — never the edge list |

Profile may show counts; edge listing and block/mute enforcement are Social/Safety queries.

---

## 6. Collection relationship

```text
User (1) ──owns── (*) Collection   (only if creator_status = ACTIVE to create)
User (viewer) ──engages── (*) Collection   (via Engagement BC)
```

| Concern | Rule |
|---------|------|
| Who may create Collections | **Only `creator_status = ACTIVE`** (draft or published). Equivalent: computed `is_creator` |
| Become Creator | Onboarding on the **same User**: typically `NONE` → `ONBOARDING` → `ACTIVE`; no Creator entity |
| Ownership FK | `Collection.creator_id` → `User.id` |
| **Ownership immutability** | **Collection ownership is immutable. Ownership transfer is not supported in V1.** (Affects analytics, commissions, attribution, URLs, search, recommendations, legal ownership — forbid now rather than retrofit.) |
| Visibility / lifecycle | **Collection** |
| On User soft-delete | Collections **remain**; **hidden from public discovery** until User restored; **no hard delete** of Collections |
| Creator display | Collection snapshot ← User public profile |
| Creator suspended | User may keep owned Collections; **cannot** create new or publish while `creator_status ≠ ACTIVE` (existing Collection visibility policy is Collection BC) |

**Permissions (V1)**
- Active creator owner: full write on own Collections (subject to Collection rules).
- Non-active creators (`NONE` / `ONBOARDING` / `SUSPENDED`): consume / engage only; no create/publish.
- Admins: future capability grants (not a second person type).

---

## 7. Search (attributes only — do not implement)

**Searchable sources (canonical):** `username`, `display_name`, `bio`, `creator_status` (or derived `is_creator`), `account_type`; later `creator_category`, `is_verified`, optional `country`.

**Not searchable:** email, phone, notification/privacy prefs, devices, any Social/Safety edges.

User owns canonical fields; Search owns the index.

---

## 8. Feed (consume only — do not implement)

Bylines: `id`, `username`, `display_name`, `profile_photo_url`, `creator_status` (or derived `is_creator`); later `is_verified`.

Prefer Collection creator snapshot on the hot path.

---

## 9. Recommendations (signals only — do not implement)

May consume: `creator_status`, `country`, `language`; later `creator_category`, Social graph features, engagement affinity, opt-in `content_preferences`.

User does **not** store embeddings or candidate sets.

---

## 10. Analytics (ownership — do not implement)

| Analytics | Owner |
|-----------|--------|
| Profile views, follow funnels, creator activation | **Analytics** events keyed by `user_id` |
| Materialized counters on User | **User** denorm via **async** contractual updates |
| Commerce attribution | **Commerce** + Collection; User as dimension |

On soft-delete / GDPR-style erasure: **anonymize personal data** on User; retain analytics/commerce facts with **anonymized `user_id` references** where legally permitted. Soft-delete — not cascade hard-delete of facts.

---

## 11. Lifecycle

### 11.1 Account lifecycle (`account_status`)

Answers: **Can this person log in / use the account?**

| `account_status` | Meaning |
|------------------|---------|
| `CREATED` | Provisioned; may be incomplete profile |
| `ACTIVE` | Normal account use |
| `SUSPENDED` | T&S / abuse hold on the **account** (login may be blocked) |
| `DELETED` | Soft-deleted; public profile hidden |
| `ARCHIVED` | Long-term inactive retention (ops) |

```text
signup → CREATED → ACTIVE
                    │
        ┌───────────┼────────────┐
        ▼           ▼            ▼
   SUSPENDED     DELETED      ARCHIVED
        │           │
        └──restore──► ACTIVE
```

| Transition | Side effects |
|------------|--------------|
| → `CREATED` / `ACTIVE` | Emit `UserCreated`; `id` = auth user id; `creator_status` starts at `NONE` |
| → `SUSPENDED` (account) | Emit `AccountSuspended`; revoke sessions (Auth); discovery policy may hide content |
| → `DELETED` | Soft-delete User; emit `AccountDeleted`; **hide owned Collections from public discovery**; Collections rows retained; ownership unchanged |
| → `ACTIVE` (restore) | Emit `AccountRestored`; Collections may return to prior eligibility rules |

### 11.2 Creator lifecycle (`creator_status`)

Answers: **Can this person publish Collections?** Independent of `account_status`.

| `creator_status` | Meaning |
|------------------|---------|
| `NONE` | Default; not in creator program |
| `ONBOARDING` | Application / onboarding in progress |
| `ACTIVE` | May create/publish Collections |
| `SUSPENDED` | Creator privileges held; browsing may continue if `account_status = ACTIVE` |

```text
NONE ──start onboarding──► ONBOARDING ──complete──► ACTIVE
                              │                         │
                              └── reject / abandon ──► NONE
                                                        │
                                                   SUSPENDED
                                                   (reinstate → ACTIVE)
```

Account `SUSPENDED`/`DELETED` and creator `SUSPENDED` are **orthogonal**. Do not infer one from the other.

---

## 12. Read model

| Consumer | Needs | Must not see |
|----------|-------|--------------|
| **Collection** | Public profile for snapshots; `id`; `creator_status = ACTIVE` gate | Private prefs |
| **Profile** | Public profile + public stats | Private account |
| **Settings** | Mirrored email (read), locale, profile edit | Others’ private data |
| **Search / Feed / Recs** | Public attributes / bylines / signals | Private / Safety graphs |
| **Notifications** | `id`, locale; later notification prefs | Push tokens live in Notifications BC |
| **Admin / T&S** | Identity, `account_status`, `creator_status` | Secrets |
| **Commerce** | `id` for attribution | Profile clutter |

---

## 13. Write model

**Only User Service** mutates the User aggregate. Counters: **async** contractual writes from Social/Analytics.

| Operation | Phase | Owner |
|-----------|-------|-------|
| **Create User** | V1 | User Service (auth signup); `id = auth.users.id`; `creator_status = NONE` |
| **Update Profile** | V1 | User Service |
| **Change Username** | V1 | User Service; reserve old handle **90 days** + redirect |
| **Update Locale** | V1 | User Service |
| **Start Creator Onboarding** | V1 | User Service; `NONE` → `ONBOARDING` |
| **Complete Creator Onboarding** | V1 | User Service; `ONBOARDING` → `ACTIVE` |
| **Reject / Abandon Creator Onboarding** | V1 | User Service / Admin; → `NONE` (or remain non-`ACTIVE` by policy) |
| **Suspend Creator** | V1 / Admin | User Service; `ACTIVE` → `SUSPENDED` (account may stay `ACTIVE`) |
| **Reinstate Creator** | V1 / Admin | User Service; `SUSPENDED` → `ACTIVE` |
| **Suspend / Reinstate Account** | V1 | Admin / T&S; mutates **`account_status` only** |
| **Delete / Restore Account** | V1 | User Service / Ops; soft-delete + Collection hide policy; ownership immutable |
| **Refresh materialised counts** | V1 slots | Social/Analytics → User (async) |
| **Update notification/privacy/content prefs** | **Future** | User Service |
| **Verify / Unverify** | **Future** | T&S via User Service |
| Sync email mirror from Auth | V1 | Auth → User (one-way) |

**Not User writes:** Block/Mute (Social/Safety); device token registration (Notifications); Auth password/session; Collection ownership transfer (forbidden in V1).

---

## 14. Events

| Event | When | Phase |
|-------|------|-------|
| `UserCreated` | Account provisioned (`creator_status = NONE`) | V1 |
| `ProfileUpdated` | Public profile changed | V1 |
| `UsernameChanged` | Handle changed (`old`, `new`) | V1 |
| `CreatorStatusChanged` | `creator_status` transition (`from`, `to`) | V1 |
| `AccountSuspended` / `AccountReinstated` | `account_status` transitions | V1 |
| `AccountDeleted` / `AccountRestored` | Soft delete / restore | V1 |
| `PreferencesUpdated` | Prefs changed | Future |
| `UserVerified` / `UserUnverified` | Badge | Future |

Payload: `userId`, `occurredAt`, relevant fields (include `from`/`to` for status changes).

Convenience aliases such as “CreatorEnabled” may be derived when `to = ACTIVE`, but the canonical event is **`CreatorStatusChanged`**.

---

## 15. Boundaries (normative)

User must never own:

- Collections / media / product tags (only ownership FK + snapshots elsewhere)  
- Products / shopping / offers  
- Recommendation models or indexes  
- Search indexes  
- Analytics/engagement event logs  
- Notification delivery or **device tokens**  
- Follow / **block** / **mute** relationship graphs  

---

## 16. Extensibility (future — inactive in V1)

| Future | Mechanism |
|--------|-----------|
| Verification program | `is_verified` + T&S workflow; may interact with `creator_status` without replacing it |
| Creator category / programs | Fields + program membership |
| Notification & privacy preferences | Private settings on User; delivery/tokens in Notifications |
| Recommendation preference seeds | Opt-in `content_preferences` |
| Public metadata extensions | `public_metadata` / `extensions` |
| Organizations / teams | **Organization BC** later; User remains the person |
| Business accounts beyond flag | Enrich `account_type=business`; orgs later |
| Moderators / admins | Role grants on `user_id` |
| Multi-auth providers | Identity child rows |
| Social follow + Safety block/mute | **Social / Safety** BC |
| Ownership transfer | Explicitly **out of V1**; requires a future Collection + Commerce + Analytics program if ever allowed |

---

## 17. Mystash principles (applied)

1. **One aggregate root:** User.  
2. **Creator = `creator_status` on User**, not a separate entity; `is_creator` is computed (`== ACTIVE`).  
3. **Separate axes:** `account_status` (login/use) ≠ `creator_status` (publish).  
4. **No duplicate people:** snapshots are denorm.  
5. **Strict boundaries:** Social/Safety/Notifications/Analytics outside User graphs.  
6. **V1 simple:** Auth-aligned id, core profile, dual statuses, immutable Collection ownership.  
7. **Scale:** millions of Users; no embedded social graphs on the User row.

---

## 18. Existing Mystash mapping

| Today | Target |
|-------|--------|
| Supabase `auth.users` | Auth SoT for credentials; **`User.id = auth.users.id`** |
| `ingest_requests.user_id` | Same id |
| `Collection.creator_id` | Same id; create/publish requires `creator_status = ACTIVE`; **ownership immutable in V1** |
| Free-text video creator fields | User profile + Collection snapshot |
| No followers / block tables | Future Social / Safety BC |

**Reuse:** Supabase Auth.  
**Create:** User profile/account record + `account_status` + `creator_status`.  
**Do not duplicate:** Auth password storage; Social/Safety edges; Notification device tokens; stored boolean `is_creator` as SoT.

---

## 19. Architectural decisions (resolved) & deferred details

### 19.1 Resolved (domain-model locked)

| Decision | Resolution |
|----------|------------|
| User id vs Auth | **`User.id = auth.users.id`**. No link table. |
| Email SoT | **Auth is SoT.** Mirror to User only as denormalized Settings read field; never update email via User as source of truth. |
| Follow | **Separate Social BC** (defined, not implemented yet). User owns **materialized counts only**. |
| Block / mute | **Social / Safety BC** — **not** User-owned relationships. |
| User delete → Collections | **Soft-delete User.** Collections **remain**, **hidden from public discovery** until restore. No hard delete. |
| Creator model | **`creator_status`:** `NONE` \| `ONBOARDING` \| `ACTIVE` \| `SUSPENDED`. **`is_creator` is computed** (`== ACTIVE`), not stored SoT. |
| Account vs creator status | **Orthogonal.** `account_status` = login/use; `creator_status` = publish eligibility. |
| Create Collection gate | **Only `creator_status = ACTIVE`.** Onboarding lives on User; no Creator entity. |
| Collection ownership | **Immutable in V1.** No ownership transfer. |
| Username change | **Allowed.** Reserve old username **90 days** and **redirect**. |
| Brand / org in V1 | **No Organization BC in V1.** Business = `account_type = business` on User. Orgs later. |
| Device push tokens | **Notifications BC**, not User. |
| Counter updates | **Asynchronous** contractual denorm from Social/Analytics events. |
| GDPR / retention | Soft-delete + **anonymize** personal data; keep analytics/commerce facts with **anonymized user references** where legally permitted. |

### 19.2 Deferred (safe later — does not change aggregate boundaries)

| Item | Why safe to defer |
|------|-------------------|
| Exact username redirect URL shape and collision UX | Policy mechanics on top of reserved-handle rule already locked |
| Whether V1 stores `email_mirrored` column or reads Auth live in Settings | Read-model optimization; Auth remains SoT either way |
| When to activate verification / creator_category / banner | Future capabilities; nullable fields don’t split the aggregate |
| Exact Collection “hidden from discovery” mechanism (eligibility flags vs status) | Collection BC owns eligibility; User delete only **requires** hide — implementation can choose Collection fields later |
| Soft-delete anonymization field list / crypto of anonymized ids | Compliance procedure detail; ownership and soft-delete policy already locked |
| Async counter transport (log vs queue vs outbox) | Infra; contractual denorm pattern already locked |
| Multi-auth provider child schema | Extensibility; V1 single auth subject via identical ids |
| Rejected-application retention (`NONE` vs audit trail child) | Policy detail; non-`ACTIVE` already blocks publish |
| Whether DTO exposes `is_creator` boolean alongside `creator_status` | Presentation; SoT remains `creator_status` |

---

## Appendix A — Non-goals

- SQL / Prisma / migrations / APIs  
- Implementing Social, Safety, Follow, Feed, Search, Recs, Analytics, Notifications  
- Separate Creator entity  
- Stored boolean `is_creator` as domain SoT (use `creator_status`)  
- User-owned block/mute/follow graphs or device token stores  
- Collection ownership transfer in V1  
- Storing Collections or products inside User  

---

## Appendix B — Future capabilities checklist (defined, inactive in V1)

- Verification (`is_verified`)  
- Creator category  
- Organization / teams support  
- Deep business accounts (beyond `account_type`)  
- Notification preferences  
- Privacy preferences  
- Device references (Notifications BC)  
- Recommendation content preferences  
- Public metadata extensions  
- Collection ownership transfer (explicit future program only)  

---

*End of User Domain Specification.*
