# Engagement Domain Implementation Plan

**Spec:** [`ENGAGEMENT_DOMAIN_SPEC.md`](./ENGAGEMENT_DOMAIN_SPEC.md) (canonical; §16 frozen)  
**Status:** Implement V1 boundary — no commit until requested  
**Stance:** New Engagement BC. Event SoT lives here. Analytics mirrors later. Collection/User counters remain denorm slots only.

---

## Spec decisions locked (V1)

| Topic | Decision |
|-------|----------|
| Event SoT | **Engagement** InteractionFact |
| Idempotency | Client UUID `event_id`; unique server-side |
| Follow | Engagement relationship edge (no Social BC) |
| Save | Collection SAVE edge; **no Like** |
| Impression ≠ View | Both types supported; View = meaningful |
| MerchantClick | Shopping emits → Engagement records; dual-write `product_clicks` |
| Attribution | Primary `collection_product_tag_id`; secondary catalog/collection/creator |
| Counters | Near-realtime projections + async denorm to Collection/User |
| CounterUpdated | Batch/significant delta only (emit sparingly) |
| Facts | Immutable; compensating types reserved |
| Affinity / Session / engagement_revision / CreatorAuthority formulas | **Out of V1** (reserved) |

**Out of V1 build:** Affinity batch jobs, SessionAggregate, trending formulas, GDPR erase worker, Analytics mirror pipeline, Like, comments, purchase attribution settlement, Safety block graph.

---

## Architecture

```text
backend/src/engagement/
  EngagementService          ← record facts, edges, counters
  EngagementRepository       ← facts / edges / counter projections
  ports                      ← Collection/User counter denorm
  routes                     ← minimal HTTP ingest
       ▲
Shopping productRedirect ──emit MerchantClicked──► EngagementService
Client ──POST /engagement/events | follow | save──► EngagementService
Engagement ──async denorm──► Collection.applyCounters / User.applyCounters
```

---

## Implementation steps

### 1. Migration

`supabase/migrations/20260807120000_engagement_domain.sql`

- `engagement_interaction_facts` (immutable; unique `event_id`)
- `engagement_relationship_edges` (FOLLOW / SAVE / …; unique active edge)
- `engagement_counter_projections` (object_type, object_id, counter_name → value)
- Indexes per spec §15 subset
- RLS enabled; service-role writes

### 2. Domain module

- Types: interaction types, privacy class, edge types, fact/edge shapes
- Events: CollectionViewed, CollectionSaved, CreatorFollowed, MerchantClicked, CounterUpdated (batched), …
- InMemory + Supabase repositories
- EngagementService + factory
- Denorm ports (noop + wired adapters)

### 3. EngagementService V1 API

| Capability | Behavior |
|------------|----------|
| `recordFact` | Idempotent insert by `event_id`; emit domain event; bump counters |
| `followCreator` / `unfollowCreator` | Edge + facts + follower/following counters |
| `saveCollection` / `unsaveCollection` | Edge + facts + saves counter |
| `recordCollectionView` | View fact + views counter |
| `recordMerchantClicked` | MerchantClick fact (+ optional collection product_clicks); used by Shopping |
| `getEdge` / `listFollows` | Relationship reads |

### 4. Wire

- `productRedirect`: keep `product_clicks` insert; also call `recordMerchantClicked`
- Register engagement routes on Express app
- Denorm adapters → CollectionService/UserService `applyCounters`

### 5. Verify

- Unit tests (facts idempotency, follow/save, merchant click, counters)
- `npm run build` + `npm test`
- No commit

---

## Explicit non-goals

Affinity jobs, SessionAggregate, engagement_revision, Analytics warehouse, Safety BC, Like, frontend UI, purchase settlement.
